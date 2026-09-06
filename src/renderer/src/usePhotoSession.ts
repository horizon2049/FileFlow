import { useCallback, useRef, useState } from 'react'
import type { Photo } from '@shared/types'

/** 一条待撤销记录：批次 id + 每张照片删除前在列表中的下标。 */
interface UndoRecord {
  batchId: string
  positions: { photo: Photo; index: number }[]
}

export interface Toast {
  id: number
  kind: 'info' | 'error'
  text: string
}

/** 删除前的确认信息，由 UI 渲染成对话框。 */
export interface PendingDeletion {
  photos: Photo[]
  /** 会被一起删掉的附属文件总数。 */
  sidecarCount: number
}

const TOAST_MS = { info: 3000, error: 6000 } as const

/**
 * 选片会话的全部状态与动作：加载目录、移动光标、标记淘汰、删除、撤销。
 * 组件只消费这里返回的东西，不直接调用 window.photoflow。
 */
export function usePhotoSession() {
  const [dir, setDir] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [cursor, setCursor] = useState(0)
  /** 标记为淘汰的 JPG 绝对路径。 */
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pending, setPending] = useState<PendingDeletion | null>(null)

  const undoStack = useRef<UndoRecord[]>([])
  const [undoDepth, setUndoDepth] = useState(0)
  const toastSeq = useRef(0)
  /** 回调里要读最新的 photos，又不想每次列表变更都重建回调。 */
  const photosRef = useRef<Photo[]>([])
  photosRef.current = photos

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { id, kind, text }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_MS[kind])
  }, [])

  const fail = useCallback(
    (err: unknown) => notify(err instanceof Error ? err.message : String(err), 'error'),
    [notify]
  )

  const load = useCallback(
    async (target: string, opts: { reset: boolean }) => {
      setLoading(true)
      try {
        const result = await window.photoflow.scanDirectory(target)
        setDir(result.dir)
        setPhotos(result.photos)
        if (opts.reset) {
          setCursor(0)
          setRejected(new Set())
          undoStack.current = []
          setUndoDepth(0)
        } else {
          // 刷新后原下标可能越界，收敛到末尾；淘汰标记只保留仍存在的文件。
          setCursor((c) => Math.min(c, Math.max(result.photos.length - 1, 0)))
          const alive = new Set(result.photos.map((p) => p.path))
          setRejected((prev) => new Set([...prev].filter((p) => alive.has(p))))
        }
        return result.photos.length
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const openDirectory = useCallback(async () => {
    try {
      const picked = await window.photoflow.pickDirectory()
      if (!picked) return
      await window.photoflow.reportStaleTrash(picked)
      const count = await load(picked, { reset: true })
      notify(count > 0 ? `已加载 ${count} 张照片` : '该文件夹下没有 JPG 文件')
    } catch (err) {
      fail(err)
    }
  }, [fail, load, notify])

  const reload = useCallback(async () => {
    if (!dir) return
    try {
      const count = await load(dir, { reset: false })
      notify(`已刷新，共 ${count} 张`)
    } catch (err) {
      fail(err)
    }
  }, [dir, fail, load, notify])

  const select = useCallback((index: number) => setCursor(index), [])

  const step = useCallback((delta: number) => {
    setCursor((c) => {
      const last = photosRef.current.length - 1
      if (last < 0) return 0
      return Math.min(Math.max(c + delta, 0), last)
    })
  }, [])

  const setRejectedFlag = useCallback((photoPath: string, flag: boolean) => {
    setRejected((prev) => {
      if (prev.has(photoPath) === flag) return prev
      const next = new Set(prev)
      if (flag) next.add(photoPath)
      else next.delete(photoPath)
      return next
    })
  }, [])

  const toggleReject = useCallback((photoPath: string) => {
    setRejected((prev) => {
      const next = new Set(prev)
      if (next.has(photoPath)) next.delete(photoPath)
      else next.add(photoPath)
      return next
    })
  }, [])

  const clearRejected = useCallback(() => setRejected(new Set()), [])

  /** 打开删除确认框。targets 为空时直接提示，不弹框。 */
  const requestDelete = useCallback(
    (targets: Photo[]) => {
      if (targets.length === 0) {
        notify('没有需要删除的照片')
        return
      }
      const sidecarCount = targets.reduce((sum, p) => sum + p.sidecars.length, 0)
      setPending({ photos: targets, sidecarCount })
    },
    [notify]
  )

  const cancelDelete = useCallback(() => setPending(null), [])

  /** 执行确认框里的删除。 */
  const confirmDelete = useCallback(async () => {
    const target = pending
    if (!target) return
    setPending(null)
    setBusy(true)
    try {
      const before = photosRef.current
      const indexByPath = new Map(before.map((p, i) => [p.path, i]))
      const result = await window.photoflow.deletePhotos(target.photos)
      const removed = new Set(result.batch.photos.map((p) => p.path))

      if (removed.size > 0) {
        undoStack.current.push({
          batchId: result.batch.id,
          positions: result.batch.photos.map((photo) => ({
            photo,
            index: indexByPath.get(photo.path) ?? 0
          }))
        })
        setUndoDepth(undoStack.current.length)

        const remaining = before.filter((p) => !removed.has(p.path))
        const firstRemoved = Math.min(
          ...result.batch.photos.map((p) => indexByPath.get(p.path) ?? 0)
        )
        setPhotos(remaining)
        setRejected((prev) => new Set([...prev].filter((p) => !removed.has(p))))
        // 光标留在被删位置，于是自然落到下一张；删到末尾则退回最后一张。
        setCursor(Math.min(firstRemoved, Math.max(remaining.length - 1, 0)))
      }

      const fileCount = result.batch.entries.length
      if (result.failures.length > 0) {
        notify(
          `已删除 ${removed.size} 张（${fileCount} 个文件），${result.failures.length} 个失败：${result.failures[0].message}`,
          'error'
        )
      } else {
        notify(`已删除 ${removed.size} 张，共 ${fileCount} 个文件，可按 Ctrl+Z 撤销`)
      }
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }, [fail, notify, pending])

  /** 撤销最近一次删除，把文件搬回原位并插回列表原下标。 */
  const undo = useCallback(async () => {
    const record = undoStack.current.at(-1)
    if (!record) {
      notify('没有可撤销的删除')
      return
    }
    setBusy(true)
    try {
      const result = await window.photoflow.undoDelete(record.batchId)
      undoStack.current.pop()
      setUndoDepth(undoStack.current.length)

      if (result.restored.length > 0) {
        const restoredPaths = new Set(result.restored.map((p) => p.path))
        const slots = record.positions
          .filter((s) => restoredPaths.has(s.photo.path))
          .sort((a, b) => a.index - b.index)

        setPhotos((prev) => {
          const next = [...prev]
          for (const slot of slots) {
            next.splice(Math.min(slot.index, next.length), 0, slot.photo)
          }
          return next
        })
        setCursor(slots[0].index)
        notify(`已还原 ${result.restored.length} 张照片`)
      }
      if (result.failures.length > 0) {
        notify(`${result.failures.length} 个文件未能还原：${result.failures[0].message}`, 'error')
      }
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }, [fail, notify])

  return {
    dir,
    photos,
    cursor,
    current: photos[cursor] ?? null,
    rejected,
    loading,
    busy,
    toasts,
    pending,
    undoDepth,
    openDirectory,
    reload,
    select,
    step,
    toggleReject,
    setRejectedFlag,
    clearRejected,
    requestDelete,
    cancelDelete,
    confirmDelete,
    undo
  }
}
