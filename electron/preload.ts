import { contextBridge, ipcRenderer } from 'electron'
import type {
  AdminDashboardSnapshot,
  AppSettings,
  ChatChunk,
  ChatRequest,
  ChatSession,
  DownloadProgress,
  ElectronApi,
  LoadConfig,
  RuntimeInfo,
  ServerStatus,
} from '../src/types'

const listener = <T>(channel: string, callback: (value: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => callback(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ElectronApi = {
  getState: () => ipcRenderer.invoke('app:get-state'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('app:save-settings', settings),
  chooseRuntime: () => ipcRenderer.invoke('runtime:choose'),
  installRuntime: (flavor) => ipcRenderer.invoke('runtime:install', flavor),
  getRuntimeHelp: () => ipcRenderer.invoke('runtime:help'),
  getRuntimeResources: () => ipcRenderer.invoke('runtime:resources'),
  chooseModelFiles: () => ipcRenderer.invoke('models:choose-files'),
  chooseVisionModelPair: () => ipcRenderer.invoke('models:choose-vision-pair'),
  chooseModelProjector: (modelId: string) =>
    ipcRenderer.invoke('models:choose-projector', modelId),
  clearModelProjector: (modelId: string) =>
    ipcRenderer.invoke('models:clear-projector', modelId),
  chooseModelDirectory: () => ipcRenderer.invoke('models:choose-directory'),
  scanModels: () => ipcRenderer.invoke('models:scan'),
  removeModel: (id: string) => ipcRenderer.invoke('models:remove', id),
  getModelTemplate: (id: string) => ipcRenderer.invoke('models:get-template', id),
  chooseAuxiliaryFile: (kind) => ipcRenderer.invoke('files:choose-auxiliary', kind),
  chooseImages: () => ipcRenderer.invoke('files:choose-images'),
  getModels: () => ipcRenderer.invoke('models:get'),
  loadChat: (id: string) => ipcRenderer.invoke('chats:load', id),
  saveChat: (chat: ChatSession) => ipcRenderer.invoke('chats:save', chat),
  deleteChat: (id: string) => ipcRenderer.invoke('chats:delete', id),
  startServer: (modelId: string, config: LoadConfig) =>
    ipcRenderer.invoke('server:start', modelId, config),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  releaseServerMemory: () => ipcRenderer.invoke('server:release-memory'),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  getServerLogs: () => ipcRenderer.invoke('server:logs'),
  getAdminDashboard: () => ipcRenderer.invoke('admin:dashboard'),
  createApiKey: (input) => ipcRenderer.invoke('admin:create-api-key', input),
  revokeApiKey: (id: string) => ipcRenderer.invoke('admin:revoke-api-key', id),
  chat: (request: ChatRequest) => ipcRenderer.invoke('chat:start', request),
  cancelChat: (requestId: string) => ipcRenderer.invoke('chat:cancel', requestId),
  searchHuggingFace: (query: string) => ipcRenderer.invoke('hf:search', query),
  getHuggingFaceModel: (repoId: string) => ipcRenderer.invoke('hf:detail', repoId),
  downloadHuggingFaceFile: (repoId, fileName, expectedSize, sha256) =>
    ipcRenderer.invoke('hf:download', repoId, fileName, expectedSize, sha256),
  cancelDownload: (id: string) => ipcRenderer.invoke('hf:cancel', id),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item', path),
  onServerStatus: (callback: (status: ServerStatus) => void) =>
    listener('server:status-changed', callback),
  onServerLog: (callback: (line: string) => void) => listener('server:log', callback),
  onAdminUpdated: (callback: (snapshot: AdminDashboardSnapshot) => void) =>
    listener('admin:updated', callback),
  onChatChunk: (callback: (chunk: ChatChunk) => void) => listener('chat:chunk', callback),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) =>
    listener('hf:progress', callback),
  onRuntimeProgress: (callback: (runtime: RuntimeInfo) => void) =>
    listener('runtime:progress', callback),
}

contextBridge.exposeInMainWorld('forge', api)
contextBridge.exposeInMainWorld('electron', api)
