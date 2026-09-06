import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PREVIEW_EXTENSIONS, SIDECAR_EXTENSIONS, TRASH_DIR_NAME } from '@shared/types'
import type { Photo, ScanResult } from '@shared/types'

const previewExts = new Set<string>(PREVIEW_EXTENSIONS)
const sidecarExts = new Set<string>(SIDECAR_EXTENSIONS)

/** 判断是否是要预览的 JPG。 */
function isPreviewable(name: string): boolean {
  return previewExts.has(path.extname(name).toLowerCase())
}

/**
 * 判断 candidate 是否是 stem 的附属文件。
 * 命中两种命名习惯：
 *   1. 同名换后缀，如 P1011677.RW2 —— 相机直出的 RAW
 *   2. 在完整文件名后追加 .xmp，如 P1011677.RW2.xmp / P1011677.JPG.xmp —— 修图软件的边车
 */
function isSidecarOf(candidateLower: string, stemLower: string): boolean {
  const ext = path.extname(candidateLower)
  if (ext === '.xmp' && candidateLower.startsWith(`${stemLower}.`)) return true
  return sidecarExts.has(ext) && candidateLower.slice(0, -ext.length) === stemLower
}

/**
 * 扫描目录顶层的 JPG，并为每张 JPG 找出同目录下的同名附属文件。
 * 不进入子目录，跳过暂存区。
 */
export async function scanDirectory(dir: string): Promise<ScanResult> {
  const dirents = await fs.readdir(dir, { withFileTypes: true })
  const fileNames = dirents.filter((d) => d.isFile()).map((d) => d.name)

  // 先按小写名建索引，配对时不必反复遍历整个目录。
  const byLowerName = new Map<string, string>()
  for (const name of fileNames) byLowerName.set(name.toLowerCase(), name)

  const jpgNames = fileNames.filter(isPreviewable).sort((a, b) => a.localeCompare(b, 'en'))

  const photos: Photo[] = []
  for (const name of jpgNames) {
    const filePath = path.join(dir, name)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(filePath)
    } catch {
      // 扫描期间文件被外部删除，跳过。
      continue
    }

    const stemLower = name.slice(0, -path.extname(name).length).toLowerCase()
    const sidecars: string[] = []
    for (const [lowerName, actualName] of byLowerName) {
      if (actualName === name) continue
      if (isSidecarOf(lowerName, stemLower)) sidecars.push(path.join(dir, actualName))
    }
    sidecars.sort((a, b) => a.localeCompare(b, 'en'))

    photos.push({
      path: filePath,
      name,
      dir,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sidecars
    })
  }

  return { dir, photos }
}

/** 暂存区的根目录：照片同目录下的隐藏文件夹，保证 rename 在同一分区内完成。 */
export function trashRootFor(dir: string): string {
  return path.join(dir, TRASH_DIR_NAME)
}
