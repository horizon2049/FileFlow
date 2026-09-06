import { useEffect, useRef } from 'react'

export interface KeyboardHandlers {
  /** 忙碌或有对话框时挂起全部快捷键，避免误触。 */
  disabled: boolean
  onStep: (delta: number) => void
  onToggleReject: () => void
  onKeep: () => void
  onDelete: () => void
  onDeleteRejected: () => void
  onUndo: () => void
  onOpen: () => void
}

/**
 * 全局键盘导航。绑在 window 上，因为选片时焦点可能落在任意缩略图按钮上。
 * 处理函数每次渲染都会重建，所以用 ref 转发，监听只注册一次。
 */
export function useKeyboard(handlers: KeyboardHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const h = ref.current
      const target = event.target as HTMLElement | null
      // 留个后路：以后加搜索框时不会吞掉输入。
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const key = event.key
      const mod = event.ctrlKey || event.metaKey

      if (mod) {
        const lower = key.toLowerCase()
        if (lower === 'z') {
          event.preventDefault()
          if (!h.disabled) h.onUndo()
        } else if (lower === 'o') {
          event.preventDefault()
          if (!h.disabled) h.onOpen()
        }
        return
      }
      if (h.disabled) return

      switch (key) {
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          h.onStep(1)
          return
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          h.onStep(-1)
          return
        case 'PageDown':
          event.preventDefault()
          h.onStep(10)
          return
        case 'PageUp':
          event.preventDefault()
          h.onStep(-10)
          return
        case 'Home':
          event.preventDefault()
          h.onStep(Number.NEGATIVE_INFINITY)
          return
        case 'End':
          event.preventDefault()
          h.onStep(Number.POSITIVE_INFINITY)
          return
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          // Shift+Delete 删掉全部已标记的，单独 Delete 只删当前这张。
          if (event.shiftKey) h.onDeleteRejected()
          else h.onDelete()
          return
        default:
          break
      }

      switch (key.toLowerCase()) {
        case 'x':
          event.preventDefault()
          h.onToggleReject()
          break
        case 'p':
          event.preventDefault()
          h.onKeep()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
