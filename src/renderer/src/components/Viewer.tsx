import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { toImageUrl } from '@shared/ipc'
import type { Photo } from '@shared/types'
import { basename } from '../format'
import { useZoomPan } from '../useZoomPan'

interface Props {
  photo: Photo
  rejected: boolean
  onToggleReject: () => void
  onDelete: () => void
  /** 删除当前这个之前是否弹确认框。 */
  confirmDelete: boolean
  onConfirmDeleteChange: (flag: boolean) => void
  onReveal: () => void
  /** 在画面上右键：弹出文件菜单。 */
  onContextMenu: () => void
}

/** 暴露给父组件的命令式操作，用于键盘控制视频。 */
export interface ViewerHandle {
  /** 相对当前进度快进/回退 seconds 秒（负数为回退）；非视频时无效。 */
  seek: (seconds: number) => void
  /** 播放/暂停切换；非视频时无效。 */
  togglePlay: () => void
}

/** 大图/视频预览。图片直接加载原图；视频用 <video controls> 播放并支持流式拖动。滚轮缩放，放大后可拖拽平移。 */
const Viewer = forwardRef<ViewerHandle, Props>(function Viewer(
  { photo, rejected, onToggleReject, onDelete, confirmDelete, onConfirmDeleteChange, onReveal, onContextMenu },
  ref
): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)

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

  return (
    <div className={rejected ? 'viewer rejected' : 'viewer'}>
      {/* 按路径加 key：切换文件时缩放、加载失败等状态全部归零。 */}
      <MediaCanvas
        key={photo.path}
        photo={photo}
        rejected={rejected}
        videoRef={videoRef}
        onContextMenu={onContextMenu}
      />

      <div className="viewer-actions">
        <button onClick={onToggleReject}>
          {rejected ? '取消淘汰标记 (Z)' : '标记淘汰 (X)'}
        </button>
        <button className="danger" onClick={onDelete}>
          删除这个 (D)
        </button>
        <label className="toggle" title="关闭后按 D 直接删除，仍可 Ctrl+Z 撤销；Shift+D 批量删除始终确认">
          <input
            type="checkbox"
            checked={confirmDelete}
            onChange={(event) => onConfirmDeleteChange(event.currentTarget.checked)}
          />
          删除前确认
        </label>
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

/** 画布：按原始宽高比完整显示媒体（横竖都适配），滚轮以鼠标为锚点缩放，放大后拖拽平移，双击或点百分比复原。 */
function MediaCanvas({
  photo,
  rejected,
  videoRef,
  onContextMenu
}: {
  photo: Photo
  rejected: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  onContextMenu: () => void
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const isVideo = photo.kind === 'video'
  // 小图不拉伸放大，免得糊；视频通常分辨率够，铺满更顺眼。
  const zoom = useZoomPan({ upscale: isVideo })
  const fullUrl = toImageUrl(photo.path, { mtimeMs: photo.mtimeMs })

  const className = ['canvas', zoom.zoomed ? 'zoomed' : '', zoom.panning ? 'panning' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={zoom.containerRef}
      className={className}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu()
      }}
      onDoubleClick={(event) => {
        // 视频上的双击留给原生控件（全屏等）。
        if (!(event.target instanceof HTMLVideoElement)) zoom.reset()
      }}
    >
      {failed ? (
        <div className="empty">
          {isVideo ? '视频无法播放，可能格式不受支持或文件已损坏' : '图片无法读取，可能已被移动或损坏'}
        </div>
      ) : isVideo ? (
        <video
          ref={videoRef}
          className="media"
          style={zoom.mediaStyle}
          src={fullUrl}
          controls
          preload="metadata"
          onLoadedMetadata={(event) =>
            zoom.setNaturalSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)
          }
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          className="media"
          style={zoom.mediaStyle}
          src={fullUrl}
          alt={photo.name}
          decoding="async"
          // naturalWidth/Height 已按 EXIF 方向校正，竖拍照片拿到的就是竖图尺寸。
          onLoad={(event) =>
            zoom.setNaturalSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
          }
          onError={() => setFailed(true)}
          draggable={false}
        />
      )}
      {rejected && <div className="reject-overlay">已标记淘汰</div>}
      {!failed && zoom.zoomed && (
        <button className="zoom-chip" onClick={zoom.reset} title="恢复适应窗口（也可双击画面）">
          {Math.round(zoom.scale * 100)}%
        </button>
      )}
    </div>
  )
}
