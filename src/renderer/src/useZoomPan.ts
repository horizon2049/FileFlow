import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface Size {
  width: number
  height: number
}

/** 缩放倍数相对“适应窗口”的尺寸，x/y 是媒体中心相对画布中心的偏移（px）。 */
interface View {
  zoom: number
  x: number
  y: number
}

/** 适应窗口时四周留出的边距。 */
const FIT_PADDING = 16
/** 鼠标滚轮每像素 deltaY 的缩放灵敏度；一格滚轮约 100px，对应约 14%。 */
const WHEEL_SENSITIVITY = 0.0015
/** 触控板捏合（Chromium 以 ctrl+wheel 上报，delta 很小）的灵敏度。 */
const PINCH_SENSITIVITY = 0.01
/** 最大缩放至少是适应窗口的这么多倍…… */
const MAX_ZOOM = 8
/** ……并且至少能放大到原始像素的这么多倍，保证大图也能看清对焦。 */
const MAX_ACTUAL_SCALE = 4
/** 移动超过这个距离才算拖拽，否则保留为普通点击（视频点击播放等）。 */
const DRAG_THRESHOLD = 3
/** 原生视频控制条的大致高度，按在这里时不触发拖拽，免得和进度条抢事件。 */
const VIDEO_CONTROLS_HEIGHT = 48

const FIT_VIEW: View = { zoom: 1, x: 0, y: 0 }

interface Geometry {
  container: Size
  natural: Size
  /** 原始像素 → 适应窗口尺寸的比例。 */
  fit: number
  maxZoom: number
}

export interface ZoomPan {
  /** 挂到画布容器上：尺寸测量、滚轮、拖拽都以它为准。 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 媒体元素的绝对定位样式。原始尺寸未知前隐藏，避免闪一下错误尺寸。 */
  mediaStyle: React.CSSProperties
  /** 媒体加载出原始尺寸后调用（图片 naturalWidth/Height，视频 videoWidth/Height）。 */
  setNaturalSize: (width: number, height: number) => void
  /** 当前显示尺寸 / 原始像素，用于显示百分比。 */
  scale: number
  /** 是否放大到了超过适应窗口。 */
  zoomed: boolean
  /** 正在拖拽平移。 */
  panning: boolean
  /** 回到适应窗口。 */
  reset: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 限制缩放范围；某个方向放大后仍不超出画布就居中，否则不许拖出空白。 */
function clampView(g: Geometry, zoom: number, x: number, y: number): View {
  const z = clamp(zoom, 1, g.maxZoom)
  const limitX = Math.max(0, (g.natural.width * g.fit * z - g.container.width) / 2)
  const limitY = Math.max(0, (g.natural.height * g.fit * z - g.container.height) / 2)
  return { zoom: z, x: clamp(x, -limitX, limitX), y: clamp(y, -limitY, limitY) }
}

/**
 * 媒体预览的适应窗口 + 滚轮缩放 + 拖拽平移。
 * 按原始宽高比和画布尺寸算出完整显示所需的尺寸，横图竖图都按较紧的一边对齐；
 * 缩放直接改元素宽高而不用 transform，图片放大后由浏览器按原图重采样，视频控制条也保持原大小。
 * 状态不随文件切换重置，调用方应给组件加 key。
 */
export function useZoomPan(options: { upscale: boolean }): ZoomPan {
  const containerRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<Size | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [view, setView] = useState<View>(FIT_VIEW)
  const [panning, setPanning] = useState(false)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = (): void => {
      setContainer((prev) =>
        prev && prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  let geometry: Geometry | null = null
  if (container && natural && natural.width > 0 && natural.height > 0) {
    const fit = Math.min(
      Math.max(container.width - FIT_PADDING * 2, 1) / natural.width,
      Math.max(container.height - FIT_PADDING * 2, 1) / natural.height,
      options.upscale ? Number.POSITIVE_INFINITY : 1
    )
    geometry = { container, natural, fit, maxZoom: Math.max(MAX_ZOOM, MAX_ACTUAL_SCALE / fit) }
  }

  // 原生监听只注册一次，几何信息走 ref 拿最新值。
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  // 窗口缩放后适应尺寸变了，已有的平移量可能越界，重新夹一次。
  const fit = geometry?.fit
  useEffect(() => {
    const g = geometryRef.current
    if (g) setView((v) => clampView(g, v.zoom, v.x, v.y))
  }, [fit, container])

  // React 的 onWheel 是 passive 的，没法 preventDefault，所以手动注册。
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(event: WheelEvent): void {
      const g = geometryRef.current
      if (!g) return
      event.preventDefault()
      const rect = el!.getBoundingClientRect()
      // 鼠标相对画布中心的位置，缩放以它为锚点。
      const mx = event.clientX - rect.left - rect.width / 2
      const my = event.clientY - rect.top - rect.height / 2
      // deltaMode 1 表示按行滚动（部分 Windows 鼠标），换算成像素。
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      const factor = Math.exp(-delta * (event.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY))
      setView((v) => {
        const zoom = clamp(v.zoom * factor, 1, g.maxZoom)
        const ratio = zoom / v.zoom
        // 保持鼠标下的那个点不动。
        return clampView(g, zoom, mx - (mx - v.x) * ratio, my - (my - v.y) * ratio)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let drag: { id: number; startX: number; startY: number; x: number; y: number; active: boolean } | null =
      null
    // 拖拽松手后紧跟的那次 click 要吞掉，否则视频会被当成点击而切换播放。
    let suppressClick = false

    function onPointerDown(event: PointerEvent): void {
      suppressClick = false
      if (event.button !== 0 || viewRef.current.zoom <= 1 || !geometryRef.current) return
      const target = event.target
      if (
        target instanceof HTMLVideoElement &&
        event.clientY > target.getBoundingClientRect().bottom - VIDEO_CONTROLS_HEIGHT
      ) {
        return
      }
      const v = viewRef.current
      drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: v.x, y: v.y, active: false }
    }

    function onPointerMove(event: PointerEvent): void {
      const g = geometryRef.current
      if (!drag || drag.id !== event.pointerId || !g) return
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        drag.active = true
        el!.setPointerCapture(event.pointerId)
        setPanning(true)
      }
      const { x, y } = drag
      setView((v) => clampView(g, v.zoom, x + dx, y + dy))
    }

    function onPointerEnd(event: PointerEvent): void {
      if (!drag || drag.id !== event.pointerId) return
      if (drag.active) {
        suppressClick = true
        if (el!.hasPointerCapture(event.pointerId)) el!.releasePointerCapture(event.pointerId)
      }
      drag = null
      setPanning(false)
    }

    function onClick(event: MouseEvent): void {
      if (!suppressClick) return
      suppressClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    el.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('click', onClick, true)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [])

  const setNaturalSize = useCallback((width: number, height: number) => {
    setNatural({ width, height })
  }, [])

  const reset = useCallback(() => setView(FIT_VIEW), [])

  let mediaStyle: React.CSSProperties
  if (geometry) {
    const width = geometry.natural.width * geometry.fit * view.zoom
    const height = geometry.natural.height * geometry.fit * view.zoom
    mediaStyle = {
      width,
      height,
      left: geometry.container.width / 2 + view.x - width / 2,
      top: geometry.container.height / 2 + view.y - height / 2
    }
  } else if (container && natural) {
    // 拿到了尺寸但是 0（比如纯音频的视频容器）：铺满画布，不参与缩放。
    mediaStyle = { width: container.width, height: container.height, left: 0, top: 0 }
  } else {
    mediaStyle = { visibility: 'hidden' }
  }

  return {
    containerRef,
    mediaStyle,
    setNaturalSize,
    scale: geometry ? geometry.fit * view.zoom : 1,
    zoomed: view.zoom > 1,
    panning,
    reset
  }
}
