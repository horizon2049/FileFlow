import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePhotoSession } from './usePhotoSession'
import { useKeyboard } from './useKeyboard'
import { basename, formatBytes } from './format'
import Thumbnail from './components/Thumbnail'
import Viewer from './components/Viewer'
import ConfirmDialog from './components/ConfirmDialog'
import Toasts from './components/Toasts'
import Shortcuts from './components/Shortcuts'

export default function App(): React.JSX.Element {
  const s = usePhotoSession()
  const { dir, photos, cursor, current, rejected, loading, busy, pending, undoDepth } = s

  const rejectedPhotos = useMemo(
    () => photos.filter((p) => rejected.has(p.path)),
    [photos, rejected]
  )

  const stripRef = useRef<HTMLDivElement>(null)

  // 光标移动后把当前格滚进视野，否则键盘翻页会跟丢。
  useEffect(() => {
    const node = stripRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [cursor, photos.length])

  const deleteCurrent = useCallback(() => {
    if (current) s.requestDelete([current])
  }, [current, s])

  const deleteRejected = useCallback(() => {
    s.requestDelete(rejectedPhotos)
  }, [rejectedPhotos, s])

  useKeyboard({
    disabled: busy || loading || pending !== null,
    onStep: s.step,
    onToggleReject: () => current && s.toggleReject(current.path),
    onKeep: () => current && s.setRejectedFlag(current.path, false),
    onDelete: deleteCurrent,
    onDeleteRejected: deleteRejected,
    onUndo: () => void s.undo(),
    onOpen: () => void s.openDirectory()
  })

  return (
    <div className="app">
      <header className="toolbar">
        <button className="primary" onClick={() => void s.openDirectory()} disabled={loading || busy}>
          打开文件夹
        </button>
        <button onClick={() => void s.reload()} disabled={!dir || loading || busy}>
          刷新
        </button>
        <div className="path" title={dir ?? ''}>
          {dir ?? '尚未选择文件夹'}
        </div>
        <div className="counters">
          <span className="mono">{photos.length > 0 ? `${cursor + 1} / ${photos.length}` : '0 / 0'}</span>
          <span className={rejectedPhotos.length > 0 ? 'chip warn' : 'chip'}>
            淘汰 {rejectedPhotos.length}
          </span>
        </div>
        <button onClick={s.clearRejected} disabled={rejectedPhotos.length === 0 || busy}>
          清空标记
        </button>
        <button className="danger" onClick={deleteRejected} disabled={rejectedPhotos.length === 0 || busy}>
          删除已标记
        </button>
        <button onClick={() => void s.undo()} disabled={undoDepth === 0 || busy}>
          撤销删除{undoDepth > 1 ? ` (${undoDepth})` : ''}
        </button>
      </header>

      <main className="body">
        <section className="stage">
          {current ? (
            <Viewer
              photo={current}
              rejected={rejected.has(current.path)}
              onToggleReject={() => s.toggleReject(current.path)}
              onDelete={deleteCurrent}
              onReveal={() => void window.photoflow.revealInFolder(current.path)}
            />
          ) : (
            <Empty loading={loading} hasDir={dir !== null} onOpen={() => void s.openDirectory()} />
          )}
        </section>

        <aside className="filmstrip" ref={stripRef}>
          {photos.map((photo, index) => (
            <Thumbnail
              key={photo.path}
              photo={photo}
              index={index}
              active={index === cursor}
              rejected={rejected.has(photo.path)}
              onSelect={s.select}
              onToggleReject={s.toggleReject}
            />
          ))}
        </aside>
      </main>

      <footer className="statusbar">
        {current ? (
          <>
            <span className="mono">{current.name}</span>
            <span>{formatBytes(current.size)}</span>
            <span>
              {current.sidecars.length > 0
                ? `联动 ${current.sidecars.length} 个：${current.sidecars.map(basename).join('、')}`
                : '无同名 RAW'}
            </span>
          </>
        ) : (
          <span>就绪</span>
        )}
        <Shortcuts />
      </footer>

      {pending && (
        <ConfirmDialog pending={pending} onCancel={s.cancelDelete} onConfirm={() => void s.confirmDelete()} />
      )}
      <Toasts toasts={s.toasts} />
      {busy && <div className="veil">处理中…</div>}
    </div>
  )
}

function Empty({
  loading,
  hasDir,
  onOpen
}: {
  loading: boolean
  hasDir: boolean
  onOpen: () => void
}): React.JSX.Element {
  if (loading) return <div className="empty">正在扫描…</div>
  return (
    <div className="empty">
      <p>{hasDir ? '该文件夹下没有 JPG 文件' : '选择一个相机导出的文件夹开始选片'}</p>
      <button className="primary" onClick={onOpen}>
        打开文件夹
      </button>
    </div>
  )
}
