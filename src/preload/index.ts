import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  DeleteResult,
  FileFlowApi,
  FileMenuAction,
  Photo,
  ScanResult,
  UndoResult
} from '@shared/types'

/**
 * 渲染进程唯一的主进程入口。contextIsolation 开启，渲染进程拿不到 Node，
 * 所有文件操作都要经过这里，由主进程做目录授权校验。
 */
const api: FileFlowApi = {
  pickDirectory: () => ipcRenderer.invoke(IPC.pickDirectory) as Promise<string | null>,
  scanDirectory: (dir) => ipcRenderer.invoke(IPC.scanDirectory, dir) as Promise<ScanResult>,
  deletePhotos: (photos: Photo[]) =>
    ipcRenderer.invoke(IPC.deletePhotos, photos) as Promise<DeleteResult>,
  undoDelete: (batchId) => ipcRenderer.invoke(IPC.undoDelete, batchId) as Promise<UndoResult>,
  revealInFolder: (filePath) => ipcRenderer.invoke(IPC.revealInFolder, filePath) as Promise<void>,
  reportStaleTrash: (dir) => ipcRenderer.invoke(IPC.reportStaleTrash, dir) as Promise<void>,
  showFileMenu: (filePath) => ipcRenderer.invoke(IPC.showFileMenu, filePath) as Promise<void>,
  onFileMenuAction: (listener) => {
    const handler = (_event: IpcRendererEvent, action: FileMenuAction, filePath: string): void =>
      listener(action, filePath)
    ipcRenderer.on(IPC.fileMenuAction, handler)
    return () => ipcRenderer.removeListener(IPC.fileMenuAction, handler)
  },
  copyFile: (filePath) => ipcRenderer.invoke(IPC.copyFile, filePath) as Promise<void>
}

contextBridge.exposeInMainWorld('fileflow', api)
