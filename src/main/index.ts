import path from 'node:path'
import { createReadStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain, protocol, nativeImage, shell } from 'electron'
import { IPC, IMAGE_PROTOCOL, parseImageUrl } from '@shared/ipc'
import { IMAGE_EXTENSIONS, PREVIEW_EXTENSIONS, TRASH_DIR_NAME } from '@shared/types'
import type { Photo } from '@shared/types'
import { scanDirectory } from './photoLibrary'
import { deletePhotos, flushTrashToSystem, pendingCount, undoDelete } from './trashManager'

/** 用户本次会话授权过的目录，图片协议只服务于这些目录内的文件。 */
const allowedRoots = new Set<string>()

const previewExts = new Set<string>(PREVIEW_EXTENSIONS)
const imageExts = new Set<string>(IMAGE_EXTENSIONS)

/** 自定义协议要在 app ready 之前登记，否则拿不到 fetch 权限。 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_PROTOCOL,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

/** 判断 target 是否位于某个已授权目录内，杜绝渲染进程越权读盘。 */
function isInAllowedRoot(target: string): boolean {
  const resolved = path.resolve(target)
  for (const root of allowedRoots) {
    const rel = path.relative(root, resolved)
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) return true
  }
  return false
}

/**
 * 内容安全策略。写在响应头而不是 index.html 的 meta 里，
 * 因为开发模式下 Vite 的 HMR 需要 ws 连接和内联脚本，生产则一律收紧。
 */
function applyCsp(win: BrowserWindow, isDev: boolean): void {
  const policy = isDev
    ? [
        "default-src 'self'",
        `img-src 'self' data: ${IMAGE_PROTOCOL}:`,
        `media-src 'self' ${IMAGE_PROTOCOL}:`,
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "connect-src 'self' ws: http://localhost:*"
      ]
    : [
        "default-src 'self'",
        `img-src 'self' ${IMAGE_PROTOCOL}:`,
        `media-src 'self' ${IMAGE_PROTOCOL}:`,
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-src 'none'"
      ]

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy.join('; ')]
      }
    })
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#14161a',
    title: 'FileFlow',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // 外链一律交给系统浏览器，应用内不开新窗口。
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  applyCsp(win, Boolean(devUrl))

  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 媒体协议：fileflow-img://local/?p=<绝对路径>[&w=<缩略图长边>]
 * 带 w 时用 nativeImage 缩到指定长边再返回（仅图片），网格视图靠这个避免几百张全尺寸解码。
 * 不带 w 时返回原文件：图片整体读字节返回，视频按 Range 流式返回以便拖动进度。
 */
function registerImageProtocol(): void {
  protocol.handle(IMAGE_PROTOCOL, async (request) => {
    const parsed = parseImageUrl(request.url)
    if (!parsed) return new Response('bad request', { status: 400 })

    const { filePath, width } = parsed
    const ext = path.extname(filePath).toLowerCase()
    if (!previewExts.has(ext)) {
      return new Response('unsupported type', { status: 403 })
    }
    if (!isInAllowedRoot(filePath)) return new Response('forbidden', { status: 403 })

    const resolved = path.resolve(filePath)
    const isImage = imageExts.has(ext)

    // 视频：无论是否带 w 都走流式，忽略缩略图请求（视频没有 nativeImage 缩略图）。
    if (!isImage) {
      return streamFile(resolved, mimeFor(resolved), request.headers.get('range'))
    }

    if (width === null) {
      // 图片原图直接读字节返回。不用 net.fetch(file://…)：那条路对含空格/中文/# 的
      // 路径未编码会失败，且不保证带 content-type，导致原图静默加载不出、
      // 大图预览一直停在模糊缩略图那层。
      try {
        const bytes = await fs.readFile(resolved)
        return new Response(new Uint8Array(bytes), {
          headers: { 'content-type': mimeFor(resolved), 'cache-control': 'no-store' }
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    }

    try {
      const image = nativeImage.createFromPath(resolved)
      if (image.isEmpty()) return new Response('not an image', { status: 415 })
      const { width: w, height: h } = image.getSize()
      // 已经比目标尺寸小就不放大，直接回原图。
      const thumb =
        Math.max(w, h) <= width
          ? image
          : image.resize({ ...fitTo(w, h, width), quality: 'good' })
      // Buffer 复制成 Uint8Array 再交给 Response，避免 Node Buffer 类型与 BodyInit 不兼容。
      const jpeg = new Uint8Array(thumb.toJPEG(82))
      return new Response(jpeg, {
        headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

/**
 * 以流的方式返回文件，支持 HTTP Range。视频靠这个才能拖动进度、边下边播。
 * 无 Range 头时整段返回并带 accept-ranges，让播放器知道可以随后按段请求。
 */
async function streamFile(
  filePath: string,
  contentType: string,
  rangeHeader: string | null
): Promise<Response> {
  let size: number
  try {
    size = (await fs.stat(filePath)).size
  } catch {
    return new Response('not found', { status: 404 })
  }

  const range = rangeHeader ? parseRange(rangeHeader, size) : null
  if (rangeHeader && !range) {
    // Range 语法不合法或越界，按规范回 416。
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'content-range': `bytes */${size}` }
    })
  }

  const { start, end } = range ?? { start: 0, end: size - 1 }
  const stream = createReadStream(filePath, { start, end })
  // Node 可读流转成 Web ReadableStream 交给 Response。
  const body = Readable.toWeb(stream) as ReadableStream

  const headers: Record<string, string> = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'content-length': String(end - start + 1),
    'cache-control': 'no-store'
  }
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`

  return new Response(body, { status: range ? 206 : 200, headers })
}

/** 解析单段 `bytes=start-end`；不合法或越界返回 null。只处理常见的单区间形式。 */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match

  let start: number
  let end: number
  if (rawStart === '') {
    // 后缀形式 bytes=-N：取末尾 N 字节。
    if (rawEnd === '') return null
    const suffix = Number.parseInt(rawEnd, 10)
    if (suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number.parseInt(rawStart, 10)
    end = rawEnd === '' ? size - 1 : Number.parseInt(rawEnd, 10)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start < 0 || end >= size) return null
  return { start, end }
}

/** 按长边等比缩放到 longEdge，返回 nativeImage.resize 的尺寸参数。 */
function fitTo(w: number, h: number, longEdge: number): { width: number; height: number } {
  const scale = longEdge / Math.max(w, h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** 按扩展名给原文件响应挑 content-type，缺省按 jpeg。 */
function mimeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mkv':
      return 'video/x-matroska'
    case '.avi':
      return 'video/x-msvideo'
    default:
      return 'image/jpeg'
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.pickDirectory, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '选择照片文件夹', properties: ['openDirectory' as const] }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null
    const dir = path.resolve(result.filePaths[0])
    allowedRoots.add(dir)
    return dir
  })

  ipcMain.handle(IPC.scanDirectory, async (_event, dir: string) => {
    const resolved = path.resolve(dir)
    // 只允许扫描用户通过对话框选过的目录。
    if (!allowedRoots.has(resolved)) throw new Error('该目录未经授权')
    return scanDirectory(resolved)
  })

  ipcMain.handle(IPC.deletePhotos, async (_event, photos: Photo[]) => {
    for (const photo of photos) {
      if (!isInAllowedRoot(photo.path)) throw new Error(`拒绝删除授权目录之外的文件：${photo.path}`)
      for (const sidecar of photo.sidecars) {
        if (!isInAllowedRoot(sidecar)) throw new Error(`拒绝删除授权目录之外的文件：${sidecar}`)
      }
    }
    return deletePhotos(photos)
  })

  ipcMain.handle(IPC.undoDelete, async (_event, batchId: string) => undoDelete(batchId))

  ipcMain.handle(IPC.revealInFolder, async (_event, filePath: string) => {
    if (!isInAllowedRoot(filePath)) throw new Error('该文件未经授权')
    shell.showItemInFolder(path.resolve(filePath))
  })

  ipcMain.handle(IPC.reportStaleTrash, async (event, dir: string) => {
    const resolved = path.resolve(dir)
    if (!allowedRoots.has(resolved)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) await reportStaleTrash(win, resolved)
  })
}

/** 上次会话异常退出留下的暂存区，本次打开该目录时提示用户处置。 */
async function reportStaleTrash(win: BrowserWindow, dir: string): Promise<void> {
  const root = path.join(dir, TRASH_DIR_NAME)
  const exists = await fs
    .access(root)
    .then(() => true)
    .catch(() => false)
  if (!exists) return

  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['移入系统回收站', '暂不处理'],
    defaultId: 0,
    cancelId: 1,
    message: '发现上次未清理的删除暂存区',
    detail: `${root}\n\n里面是上次会话删除但未最终清理的文件。移入系统回收站后仍可在回收站中还原。`
  })
  if (response === 0) {
    await shell.trashItem(root).catch((err: unknown) => {
      console.warn('[fileflow] 清理历史暂存区失败', err)
    })
  }
}

app.whenReady().then(() => {
  registerImageProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/** 退出前把暂存区里的文件统一交给系统回收站。 */
let flushing = false
app.on('before-quit', (event) => {
  if (flushing || pendingCount() === 0) return
  event.preventDefault()
  flushing = true
  void flushTrashToSystem().finally(() => app.quit())
})
