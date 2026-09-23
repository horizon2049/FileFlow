/** 主进程与渲染进程共用的类型与常量。 */

/** 图片预览扩展名（不区分大小写）。 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const

/** 视频预览扩展名（不区分大小写）。能否播放取决于系统解码器，容器一律先列出。 */
export const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'] as const

/** 需要预览的全部媒体扩展名 = 图片 + 视频。 */
export const PREVIEW_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] as const

/**
 * 删除 JPG 时需要一起带走的同名附属文件扩展名（不区分大小写）。
 * 覆盖常见相机厂商的 RAW 格式，外加修图软件生成的 XMP 边车文件。
 */
export const SIDECAR_EXTENSIONS = [
  '.rw2', // Panasonic
  '.cr2', // Canon
  '.cr3', // Canon
  '.crw', // Canon 早期
  '.nef', // Nikon
  '.nrw', // Nikon
  '.arw', // Sony
  '.srf', // Sony
  '.sr2', // Sony
  '.orf', // Olympus / OM System
  '.raf', // Fujifilm
  '.pef', // Pentax
  '.dng', // Adobe / 通用
  '.rwl', // Leica
  '.raw', // 通用
  '.3fr', // Hasselblad
  '.iiq', // Phase One
  '.gpr', // GoPro
  '.xmp' // 修图元数据边车
] as const

/** 暂存区目录名，位于照片所在目录下。 */
export const TRASH_DIR_NAME = '.fileflow-trash'

/** 媒体类型：图片或视频。 */
export type MediaKind = 'image' | 'video'

/** 单个媒体文件（图片或视频）。 */
export interface Photo {
  /** 文件绝对路径，同时作为列表 key。 */
  path: string
  /** 文件名，含扩展名，如 P1011677.JPG。 */
  name: string
  /** 图片还是视频。 */
  kind: MediaKind
  /** 所在目录的绝对路径。 */
  dir: string
  /** 字节数。 */
  size: number
  /** 最后修改时间，毫秒时间戳。 */
  mtimeMs: number
  /** 同名附属文件的绝对路径，删除时一并处理。 */
  sidecars: string[]
}

/** 打开文件夹的结果。 */
export interface ScanResult {
  dir: string
  photos: Photo[]
}

/** 一次删除操作，用于撤销。 */
export interface DeleteBatch {
  /** 批次 id，撤销时回传。 */
  id: string
  /** 批次内每个文件从原位置搬到暂存区的记录。 */
  entries: TrashEntry[]
  /** 该批次涉及的照片路径，用于渲染进程恢复列表。 */
  photos: Photo[]
}

/** 暂存区里的一个文件。 */
export interface TrashEntry {
  /** 原始绝对路径。 */
  originalPath: string
  /** 暂存区中的绝对路径。 */
  trashPath: string
}

/** 删除结果。 */
export interface DeleteResult {
  batch: DeleteBatch
  /** 未能删除的文件及原因。 */
  failures: { path: string; message: string }[]
}

/** 撤销结果。 */
export interface UndoResult {
  /** 成功还原的照片，渲染进程据此重新插回列表。 */
  restored: Photo[]
  failures: { path: string; message: string }[]
}

/** preload 暴露给渲染进程的 API 形状。 */
export interface FileFlowApi {
  /** 弹出系统目录选择框；用户取消时返回 null。 */
  pickDirectory: () => Promise<string | null>
  /** 扫描目录顶层的 JPG，不进入子目录。 */
  scanDirectory: (dir: string) => Promise<ScanResult>
  /** 把照片及其附属文件搬进暂存区。 */
  deletePhotos: (photos: Photo[]) => Promise<DeleteResult>
  /** 撤销一个批次，把文件搬回原位。 */
  undoDelete: (batchId: string) => Promise<UndoResult>
  /** 用系统默认程序打开文件所在目录并选中文件。 */
  revealInFolder: (filePath: string) => Promise<void>
  /** 询问主进程该目录下是否残留上次会话的暂存区，有则弹窗让用户处置。 */
  reportStaleTrash: (dir: string) => Promise<void>
}
