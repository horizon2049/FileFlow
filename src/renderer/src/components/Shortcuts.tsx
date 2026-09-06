const KEYS: [string, string][] = [
  ['← →', '切换'],
  ['X', '标记淘汰'],
  ['P', '保留'],
  ['Delete', '删除当前'],
  ['Shift+Delete', '删除已标记'],
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
