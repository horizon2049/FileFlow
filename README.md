# PhotoFlow

相机选片桌面端应用。只预览文件夹里的 JPG，删除 JPG 时自动带走同名的 RAW/XMP 文件。

## 核心行为

- **只列 JPG**：扫描所选文件夹顶层的 `.jpg` / `.jpeg`，不进子目录。
- **联动删除**：删 `P1011677.JPG` 时，同目录下同名的 `P1011677.RW2`、`P1011677.CR3`、`P1011677.xmp` 等一并删除。完整清单见 `src/shared/types.ts` 的 `SIDECAR_EXTENSIONS`，匹配不区分大小写。删除前的确认框会逐条列出要带走的文件。
- **两段式删除**：删除时文件先移入照片目录下的隐藏文件夹 `.photoflow-trash/<批次id>/`（同分区 rename，SD 卡上也是瞬时完成），所以可以无限次撤销；退出应用时把整个暂存区一次性交给系统回收站。
- **异常退出的残留**：下次打开同一目录时会弹窗询问，可选择移入系统回收站或暂不处理。

## 快捷键

| 键 | 作用 |
|---|---|
| `←` `→` `↑` `↓` | 上一张 / 下一张 |
| `PageUp` `PageDown` | 跳 10 张 |
| `Home` `End` | 首张 / 末张 |
| `X` | 标记淘汰 / 取消标记 |
| `P` | 标记保留（清除淘汰标记）|
| `Delete` | 删除当前这张 |
| `Shift+Delete` | 删除全部已标记的 |
| `Ctrl+Z` | 撤销上一次删除 |
| `Ctrl+O` | 打开文件夹 |

胶片条里双击一格也可以切换淘汰标记。

## 开发

```bash
npm install
npm run dev          # 启动开发模式
npm run typecheck    # 类型检查
npm run build        # 类型检查 + 构建产物到 out/
```

## 打包

Windows 安装包需要在 Windows 机器上执行（macOS 上交叉构建 NSIS 要额外装 wine）：

```bash
npm run build:win    # 产出 release/PhotoFlow-<版本>-x64-setup.exe
```

macOS / Linux 的配置已在 `electron-builder.yml` 里写好：

```bash
npm run build:mac    # dmg，arm64 + x64
npm run build:linux  # AppImage
```

`npm run build:unpack` 只解包不打安装器，用来快速验证打包后的运行时行为。

## 结构

```
src/
  shared/      主进程与渲染进程共用的类型、IPC 频道名、图片 URL 编解码
  main/        窗口、图片协议、目录扫描、暂存区与回收站
  preload/     contextBridge 暴露的唯一 API 出口
  renderer/    React 界面
```

## 安全约束

渲染进程没有 Node 权限（`contextIsolation: true` / `nodeIntegration: false`），所有文件操作都走 IPC。主进程只信任用户通过系统对话框选过的目录：扫描、读图、删除都会校验目标路径位于已授权目录内，图片协议还额外限制只能读 JPG。
