/** 主进程与渲染进程之间的 IPC 频道名。 */
export const IPC = {
  pickDirectory: 'photoflow:pick-directory',
  scanDirectory: 'photoflow:scan-directory',
  deletePhotos: 'photoflow:delete-photos',
  undoDelete: 'photoflow:undo-delete',
  revealInFolder: 'photoflow:reveal-in-folder',
  reportStaleTrash: 'photoflow:report-stale-trash'
} as const

/** 渲染进程读取本地图片用的自定义协议，绕开 file:// 在打包后的限制。 */
export const IMAGE_PROTOCOL = 'photoflow-img'

/** 缩略图长边像素，网格视图用；不传则返回原图。 */
export const THUMB_SIZE = 480

/**
 * 把本地绝对路径转成渲染进程可用的图片 URL。
 * 带 thumb 时主进程返回缩略图，避免网格里一次解码几百张全尺寸 JPG。
 * mtime 进入 URL，文件被外部改动后能自然绕过缓存。
 */
export function toImageUrl(filePath: string, opts?: { thumb?: boolean; mtimeMs?: number }): string {
  const params = new URLSearchParams({ p: filePath })
  if (opts?.thumb) params.set('w', String(THUMB_SIZE))
  if (opts?.mtimeMs !== undefined) params.set('v', String(Math.round(opts.mtimeMs)))
  return `${IMAGE_PROTOCOL}://local/?${params.toString()}`
}

/** 从图片 URL 解出本地路径和缩略图宽度；格式不对时返回 null。 */
export function parseImageUrl(url: string): { filePath: string; width: number | null } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${IMAGE_PROTOCOL}:`) return null
    const filePath = parsed.searchParams.get('p')
    if (!filePath) return null
    const rawWidth = parsed.searchParams.get('w')
    const width = rawWidth === null ? null : Number.parseInt(rawWidth, 10)
    if (width !== null && (!Number.isFinite(width) || width <= 0)) return null
    return { filePath, width }
  } catch {
    return null
  }
}
