const KEYS: [string, string][] = [
  ['↑ ↓', '切换文件'],
  ['Space', '视频播放/暂停'],
  ['← →', '视频快退/快进'],
  ['X', '标记淘汰'],
  ['Z', '取消标记'],
  ['D', '删除当前'],
  ['Shift+D', '删除已标记'],
  ['Ctrl+Z', '撤销'],
  ['Ctrl+O', '打开文件夹']
]

/** 状态栏右侧的快捷键速查。 */
export default function Shortcuts(): React.JSX.Element {
  return (
    <div className="shortcuts">
      {KEYS.map(([key, label]) => (
        <span key={key}>
          <kbd>{key}</kbd>
          {label}
        </span>
      ))}
    </div>
  )
}
