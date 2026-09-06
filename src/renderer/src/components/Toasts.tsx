import type { Toast } from '../usePhotoSession'

/** 右下角的临时提示。错误停留更久，普通提示 3 秒后自动消失。 */
export default function Toasts({ toasts }: { toasts: Toast[] }): React.JSX.Element {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}
