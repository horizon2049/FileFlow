import { useEffect, useRef } from 'react'
import type { PendingDeletion } from '../usePhotoSession'
import { basename } from '../format'

interface Props {
  pending: PendingDeletion
  onCancel: () => void
  onConfirm: () => void
}

/** 删除确认框。列出会被一起带走的 RAW/XMP，避免"只删了 JPG"或"误删 RAW"的意外。 */
export default function ConfirmDialog({ pending, onCancel, onConfirm }: Props): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        onConfirm()
      }
    }
    // 捕获阶段拦下来，不让全局快捷键在对话框开着时再触发一次删除。
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel, onConfirm])

  const total = pending.photos.length + pending.sidecarCount

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">
          删除 {pending.photos.length} 张照片，共 {total} 个文件
        </h2>
        <p className="modal-note">
          文件先移入照片目录下的 <code>.fileflow-trash</code>，可按 Ctrl+Z 撤销；退出应用时统一移入系统回收站。
        </p>

        <ul className="file-list">
          {pending.photos.slice(0, 40).map((photo) => (
            <li key={photo.path}>
              <span className="mono">{photo.name}</span>
              {photo.sidecars.length > 0 && (
                <span className="sidecar-hint"> + {photo.sidecars.map(basename).join('、')}</span>
              )}
            </li>
          ))}
          {pending.photos.length > 40 && <li>…另有 {pending.photos.length - 40} 张</li>}
        </ul>

        <div className="modal-actions">
          <button onClick={onCancel}>取消 (Esc)</button>
          <button ref={confirmRef} className="danger" onClick={onConfirm}>
            确认删除 (Enter)
          </button>
        </div>
      </div>
    </div>
  )
}
