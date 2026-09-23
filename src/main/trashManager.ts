import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type { DeleteBatch, DeleteResult, Photo, TrashEntry, UndoResult } from '@shared/types'
import { trashRootFor } from './photoLibrary'

/** 本次会话内的删除批次，供撤销使用；退出时统一交给系统回收站。 */
const batches = new Map<string, DeleteBatch>()

/** 本次会话创建过的暂存区根目录，退出时逐个清空。 */
const touchedTrashRoots = new Set<string>()

/** Windows 下 `.` 前缀不代表隐藏，需要显式打隐藏属性。失败不影响功能。 */
function hideOnWindows(dir: string): void {
  if (process.platform !== 'win32') return
  execFile('attrib', ['+h', dir], () => {})
}

/** 确保暂存区里该批次的目录存在，返回其路径。 */
async function ensureBatchDir(photoDir: string, batchId: string): Promise<string> {
  const root = trashRootFor(photoDir)
  const alreadyExists = await fs
    .access(root)
    .then(() => true)
    .catch(() => false)

  const batchDir = path.join(root, batchId)
  await fs.mkdir(batchDir, { recursive: true })
  if (!alreadyExists) hideOnWindows(root)
  touchedTrashRoots.add(root)
  return batchDir
}

/** 同分区 rename；跨分区时退化为复制后删除。 */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.copyFile(from, to)
    await fs.unlink(from)
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 把照片及其同名附属文件搬进暂存区。
 * 同一批次内所有文件放在 `<照片目录>/.fileflow-trash/<批次id>/` 下，
 * 因此文件名不会互相覆盖，撤销时也能整批还原。
 */
export async function deletePhotos(photos: Photo[]): Promise<DeleteResult> {
  const batchId = randomUUID()
  const entries: TrashEntry[] = []
  const movedPhotos: Photo[] = []
  const failures: DeleteResult['failures'] = []

  for (const photo of photos) {
    const batchDir = await ensureBatchDir(photo.dir, batchId)
    // JPG 先搬，成功了才处理附属文件，避免 JPG 还在、RAW 却没了。
    const jpgTarget = path.join(batchDir, photo.name)
    try {
      await moveFile(photo.path, jpgTarget)
      entries.push({ originalPath: photo.path, trashPath: jpgTarget })
    } catch (err) {
      failures.push({ path: photo.path, message: describe(err) })
      continue
    }

    for (const sidecar of photo.sidecars) {
      const target = path.join(batchDir, path.basename(sidecar))
      try {
        await moveFile(sidecar, target)
        entries.push({ originalPath: sidecar, trashPath: target })
      } catch (err) {
        failures.push({ path: sidecar, message: describe(err) })
      }
    }
    movedPhotos.push(photo)
  }

  const batch: DeleteBatch = { id: batchId, entries, photos: movedPhotos }
  if (entries.length > 0) batches.set(batchId, batch)
  return { batch, failures }
}

/** 把一个批次的文件从暂存区搬回原位。原位已被占用则跳过并报告。 */
export async function undoDelete(batchId: string): Promise<UndoResult> {
  const batch = batches.get(batchId)
  if (!batch) {
    return { restored: [], failures: [{ path: batchId, message: '该删除批次已不可撤销' }] }
  }

  const failures: UndoResult['failures'] = []
  const restoredPaths = new Set<string>()

  for (const entry of batch.entries) {
    const occupied = await fs
      .access(entry.originalPath)
      .then(() => true)
      .catch(() => false)
    if (occupied) {
      failures.push({ path: entry.originalPath, message: '原位置已存在同名文件' })
      continue
    }
    try {
      await fs.mkdir(path.dirname(entry.originalPath), { recursive: true })
      await moveFile(entry.trashPath, entry.originalPath)
      restoredPaths.add(entry.originalPath)
    } catch (err) {
      failures.push({ path: entry.originalPath, message: describe(err) })
    }
  }

  const restored = batch.photos.filter((p) => restoredPaths.has(p.path))
  batches.delete(batchId)
  await removeIfEmpty(batch)
  return { restored, failures }
}

/** 批次目录搬空后清掉，避免暂存区堆积空文件夹。 */
async function removeIfEmpty(batch: DeleteBatch): Promise<void> {
  const batchDirs = new Set(batch.entries.map((e) => path.dirname(e.trashPath)))
  for (const dir of batchDirs) {
    try {
      const rest = await fs.readdir(dir)
      if (rest.length === 0) await fs.rmdir(dir)
    } catch {
      // 目录不存在或非空，无需处理。
    }
  }
}

/**
 * 退出前把暂存区里的东西交给系统回收站，然后删掉暂存区目录本身。
 * 任何一步失败都只记日志：宁可留下暂存区，也不能在退出路径上抛错。
 */
export async function flushTrashToSystem(): Promise<void> {
  for (const root of touchedTrashRoots) {
    try {
      const exists = await fs
        .access(root)
        .then(() => true)
        .catch(() => false)
      if (!exists) continue

      // shell.trashItem 对整个目录生效，一次调用即可把批次连带文件送进回收站。
      const ok = await shell.trashItem(root).then(
        () => true,
        () => false
      )
      if (!ok) {
        // 回收站不可用（如网络盘、外置卡的某些文件系统），保留暂存区交由用户处置。
        console.warn(`[fileflow] 暂存区未能进入系统回收站，已原样保留：${root}`)
      }
    } catch (err) {
      console.warn(`[fileflow] 清理暂存区失败：${root}`, err)
    }
  }
  touchedTrashRoots.clear()
  batches.clear()
}

/** 暂存区里的待删文件数，用于退出确认提示。 */
export function pendingCount(): number {
  let total = 0
  for (const batch of batches.values()) total += batch.entries.length
  return total
}
