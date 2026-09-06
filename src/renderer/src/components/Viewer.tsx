import { useEffect, useState } from 'react'
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

/** 大图预览。切换照片时先显示缩略图，原图解码完再替换，翻页不至于白屏。 */
export default function Viewer({
  photo,
  rejected,
  onToggleReject,
  onDelete,
  onReveal
}: Props): React.JSX.Element {
  const [fullLoaded, setFullLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFullLoaded(false)
    setFailed(false)
  }, [photo.path])

  const thumbUrl = toImageUrl(photo.path, { thumb: true, mtimeMs: photo.mtimeMs })
  const fullUrl = toImageUrl(photo.path, { mtimeMs: photo.mtimeMs })

  return (
    <div className={rejected ? 'viewer rejected' : 'viewer'}>
      <div className="canvas">
        {failed ? (
          <div className="empty">图片无法读取，可能已被移动或损坏</div>
        ) : (
          <>
            {/* 缩略图垫底，原图加载完成后叠上去。 */}
            <img className="layer thumb-layer" src={thumbUrl} alt="" aria-hidden />
            <img
              className={fullLoaded ? 'layer full-layer ready' : 'layer full-layer'}
              src={fullUrl}
              alt={photo.name}
              decoding="async"
              onLoad={() => setFullLoaded(true)}
              onError={() => setFailed(true)}
              draggable={false}
            />
          </>
        )}
        {rejected && <div className="reject-overlay">已标记淘汰</div>}
      </div>

      <div className="viewer-actions">
        <button onClick={onToggleReject}>
          {rejected ? '取消淘汰标记 (P)' : '标记淘汰 (X)'}
        </button>
        <button className="danger" onClick={onDelete}>
          删除这张 (Delete)
        </button>
        <button onClick={onReveal}>在文件夹中显示</button>
        {photo.sidecars.length > 0 && (
          <span className="sidecar-hint">
            将一并删除：{photo.sidecars.map(basename).join('、')}
          </span>
        )}
      </div>
    </div>
  )
}
