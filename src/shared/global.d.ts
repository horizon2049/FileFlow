import type { PhotoFlowApi } from './types'

/**
 * preload 通过 contextBridge 挂到 window 上的 API。
 * 放在 shared 里，主进程/preload/渲染进程三个 tsconfig 都能看到同一份声明。
 */
declare global {
  interface Window {
    photoflow: PhotoFlowApi
  }
}
