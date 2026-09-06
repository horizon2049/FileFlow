import { memo } from 'react'
import { toImageUrl } from '@shared/ipc'
import type { Photo } from '@shared/types'

interface Props {
  photo: Photo
  index: number
  active: boolean
  rejected: boolean
  onSelect: (index: number) => void
  onToggleReject: (photoPath: string) => void
}

/**
 * 胶片条里的一格。图片走主进程的缩略图通道，
 * loading="lazy" 让滚动区外的格子先不请求。
 */
function Thumbnail({
  photo,
  index,
  active,
  rejected,
  onSelect,
  onToggleReject
}: Props): React.JSX.Element {
  const className = ['thumb', active ? 'active' : '', rejected ? 'rejected' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      data-index={index}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onToggleReject(photo.path)}
      title={`${photo.name}${photo.sidecars.length > 0 ? `（含 ${photo.sidecars.length} 个同名文件）` : ''}`}
      aria-current={active}
      aria-label={`第 ${index + 1} 张 ${photo.name}${rejected ? '，已标记淘汰' : ''}`}
    >
      <img
        src={toImageUrl(photo.path, { thumb: true, mtimeMs: photo.mtimeMs })}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      <span className="thumb-name">{photo.name}</span>
      {photo.sidecars.length > 0 && <span className="badge raw">RAW</span>}
      {rejected && <span className="badge reject">✕</span>}
    </button>
  )
}

export default memo(Thumbnail)
