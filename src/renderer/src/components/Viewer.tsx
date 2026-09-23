import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { toImageUrl } from '@shared/ipc'
import type { Photo } from '@shared/types'
import { basename } from '../format'

interface Props {
  photo: Photo
  rejected: boolean
  onToggleReject: () => void
  onDelete: () => void
  onReveal: () => void
}

/** 暴露给父组件的命令式操作，用于键盘控制视频。 */
export interface ViewerHandle {
  /** 相对当前进度快进/回退 seconds 秒（负数为回退）；非视频时无效。 */
  seek: (seconds: number) => void
  /** 播放/暂停切换；非视频时无效。 */
  togglePlay: () => void
}

/** 大图/视频预览。图片直接加载原图；视频用 <video controls> 播放并支持流式拖动。 */
const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(
  { photo, rejected, onToggleReject, onDelete, onReveal },
  ref
): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    setFailed(false)
  }, [photo.path])

  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds: number) => {
        const v = videoRef.current
        if (!v || !Number.isFinite(v.duration)) return
        const next = Math.min(Math.max(v.currentTime + seconds, 0), v.duration)
        v.currentTime = next
      },
      togglePlay: () => {
        const v = videoRef.current
        if (!v) return
        if (v.paused) void v.play().catch(() => undefined)
        else v.pause()
      }
    }),
    []
  )

  const isVideo = photo.kind === 'video'
  const fullUrl = toImageUrl(photo.path, { mtimeMs: photo.mtimeMs })

  return (
    <div className={rejected ? 'viewer rejected' : 'viewer'}>
      <div className="canvas">
        {failed ? (
          <div className="empty">
            {isVideo ? '视频无法播放，可能格式不受支持或文件已损坏' : '图片无法读取，可能已被移动或损坏'}
          </div>
        ) : isVideo ? (
          <video
            key={photo.path}
            ref={videoRef}
            className="layer full-layer ready"
            src={fullUrl}
            controls
            preload="metadata"
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            className="layer full-layer ready"
            src={fullUrl}
            alt={photo.name}
            decoding="async"
            onError={() => setFailed(true)}
            draggable={false}
          />
        )}
        {rejected && <div className="reject-overlay">已标记淘汰</div>}
      </div>

      <div className="viewer-actions">
        <button onClick={onToggleReject}>
          {rejected ? '取消淘汰标记 (Z)' : '标记淘汰 (X)'}
        </button>
        <button className="danger" onClick={onDelete}>
          删除这个 (D)
        </button>
        <button onClick={onReveal}>在文件夹中显示</button>
        {isVideo && <span className="video-hint">空格 播放/暂停 · ← → 快退/快进 5 秒</span>}
        {photo.sidecars.length > 0 && (
          <span className="sidecar-hint">
            将一并删除：{photo.sidecars.map(basename).join('、')}
          </span>
        )}
      </div>
    </div>
  )
})

export default Viewer
