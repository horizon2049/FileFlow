import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { clipboard } from 'electron'

/**
 * 把文件本身（而不是路径文本）放进系统剪贴板，之后可以在访达 / 资源管理器 / 聊天软件里直接粘贴。
 * Electron 没有跨平台的“复制文件”接口，按平台写各自的剪贴板格式。
 */
export async function copyFileToClipboard(filePath: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      // 访达认的文件列表格式是一个 plist 字符串数组。
      clipboard.writeBuffer(
        'NSFilenamesPboardType',
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
            `<plist version="1.0"><array><string>${escapeXml(filePath)}</string></array></plist>`
        )
      )
      return
    case 'win32':
      // CF_HDROP 是预定义格式，writeBuffer 写不出来，交给 PowerShell 的 Set-Clipboard。
      // 路径走环境变量传进去，不拼进命令行，避免引号和特殊字符被解释。
      await new Promise<void>((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:FILEFLOW_CLIPBOARD_PATH'],
          { env: { ...process.env, FILEFLOW_CLIPBOARD_PATH: filePath }, windowsHide: true },
          (err) => (err ? reject(new Error(`复制文件失败：${err.message}`)) : resolve())
        )
      })
      return
    default:
      // GNOME / KDE 等桌面的文件管理器约定格式。
      clipboard.writeBuffer(
        'x-special/gnome-copied-files',
        Buffer.from(`copy\n${pathToFileURL(filePath).href}`)
      )
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
