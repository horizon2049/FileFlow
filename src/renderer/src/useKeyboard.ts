import { useEffect, useRef } from 'react'

export interface KeyboardHandlers {
  /** 忙碌或有对话框时挂起全部快捷键，避免误触。 */
  disabled: boolean
  /** 上/下键切换文件；PageUp/Down、Home/End 也走这里。 */
  onStep: (delta: number) => void
  /** 左/右键快退/快进当前视频，单位秒（负数为回退）；非视频时无副作用。 */
  onSeek: (seconds: number) => void
  /** 空格键播放/暂停当前视频；非视频时无副作用。 */
  onTogglePlay: () => void
  onToggleReject: () => void
  onKeep: () => void
  onDelete: () => void
  onDeleteRejected: () => void
  onUndo: () => void
  onOpen: () => void
}

/** 左右键一次快进/快退的秒数。 */
const SEEK_STEP = 5

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
        // 上/下：切换文件。
        case 'ArrowDown':
          event.preventDefault()
          h.onStep(1)
          return
        case 'ArrowUp':
          event.preventDefault()
          h.onStep(-1)
          return
        // 左/右：视频快退/快进；对图片无副作用。
        case 'ArrowRight':
          event.preventDefault()
          h.onSeek(SEEK_STEP)
          return
        case 'ArrowLeft':
          event.preventDefault()
          h.onSeek(-SEEK_STEP)
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
        // 空格：播放/暂停视频。preventDefault 挡掉默认的页面滚动。
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          h.onTogglePlay()
          return
        default:
          break
      }

      // 字母键。大小写区分：d 删当前，D（Shift+D）删全部已标记。
      switch (key) {
        case 'x':
        case 'X':
          event.preventDefault()
          h.onToggleReject()
          break
        case 'z':
        case 'Z':
          event.preventDefault()
          h.onKeep()
          break
        case 'd':
          event.preventDefault()
          h.onDelete()
          break
        case 'D':
          event.preventDefault()
          h.onDeleteRejected()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
