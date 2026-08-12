import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AppSettings,
  Attachment,
  ChatRequest,
  ChatSession,
  CreateApiKeyInput,
  GgufModel,
  LoadConfig,
  RuntimeFlavor,
} from '../src/types'
import {
  copyImageAttachment,
  imageMimeType,
  resolveAttachmentRequest,
} from './attachments'
import { defaultSampling, makeDefaultSettings } from './defaults'
import { readGgufChatTemplate } from './gguf'
import { HuggingFaceService } from './huggingface'
import {
  inspectVisionModelPair,
  ModelScanner,
  pairVisionProjector,
  scanModelPaths,
} from './models'
import { inspectGguf } from './gguf'
import { RuntimeManager } from './runtime'
import { ServerManager } from './server'
import { AppStore } from './store'
import { ApiAccessStore } from './apiAccess'
import { ApiGateway } from './apiGateway'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | undefined
let appStore: AppStore
let runtimeManager: RuntimeManager
let serverManager: ServerManager
let apiAccess: ApiAccessStore
let apiGateway: ApiGateway
let huggingFace: HuggingFaceService
let attachmentsDirectory: string
const modelScanner = new ModelScanner()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'forge-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

function send(channel: string, value: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value)
}

/**
 * Locates the app icon. Windows wants the multi-size .ico so the taskbar and
 * Alt-Tab pick a crisp mip; other platforms take the png. dist/ is the packaged
 * location (Vite copies public/ into it), the rest are dev fallbacks.
 */
function resolveIconPath() {
  const names = process.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']
  const directories = ['../dist', '../public', '../build']
  for (const name of names) {
    for (const directory of directories) {
      const candidate = path.join(currentDirectory, directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

function createWindow() {
  const preloadPath = existsSync(path.join(currentDirectory, 'preload.mjs'))
    ? path.join(currentDirectory, 'preload.mjs')
    : path.join(currentDirectory, 'preload.js')

  const iconPath = resolveIconPath()

  mainWindow = new BrowserWindow({
    title: 'Llama AI Studio',
    icon: iconPath,
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#151516',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#19191a',
      symbolColor: '#aeb7c8',
      height: 38,
    },
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(currentDirectory, '../dist/index.html'))
  }
}

function registerIpc() {
  ipcMain.handle('app:get-state', async () => ({
    settings: appStore.settings,
    runtime: await runtimeManager.info(),
    models: appStore.models,
    chats: appStore.chats,
    server: serverManager.currentStatus(),
  }))

  ipcMain.handle('app:save-settings', async (_event, settings: AppSettings) => {
    const previousGateway = appStore.settings.apiGateway
    appStore.settings = settings
    runtimeManager.setPath(settings.runtimePath)
    if (JSON.stringify(previousGateway) !== JSON.stringify(settings.apiGateway)) {
      await apiGateway.restart()
    }
    return appStore.settings
  })

  ipcMain.handle('settings:get', () => appStore.settings)
  ipcMain.handle('settings:save', async (_event, s: AppSettings) => {
    const previousGateway = appStore.settings.apiGateway
    appStore.settings = s
    if (JSON.stringify(previousGateway) !== JSON.stringify(s.apiGateway)) {
      await apiGateway.restart()
    }
    return appStore.settings
  })

  ipcMain.handle('runtime:choose', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select llama-server executable',
      properties: ['openFile'],
      filters: [{ name: 'llama-server', extensions: ['exe'] }],
    })
    if (!result.canceled && result.filePaths[0]) {
      const settings = appStore.settings
      settings.runtimePath = result.filePaths[0]
      appStore.settings = settings
      runtimeManager.setPath(result.filePaths[0])
    }
    return runtimeManager.info()
  })

  ipcMain.handle('runtime:install', async (_event, flavor: RuntimeFlavor) => {
    const executablePath = await runtimeManager.install(flavor)
    const settings = appStore.settings
    settings.runtimePath = executablePath
    appStore.settings = settings
  })

  ipcMain.handle('runtime:help', () => runtimeManager.help())
  ipcMain.handle('runtime:resources', () => runtimeManager.resources())

  ipcMain.handle('models:get', () => appStore.models)
  ipcMain.handle('models:scan', () => rescanModels())
  ipcMain.handle('models:choose-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import GGUF model files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'GGUF models', extensions: ['gguf'] }],
    })
    if (result.canceled) return appStore.models
    const imported = await scanModelPaths(result.filePaths)
    mergeModels(imported)
    return appStore.models
  })
  ipcMain.handle('models:choose-vision-pair', async () => {
    const modelResult = await dialog.showOpenDialog({
      title: 'Select the text/language GGUF model',
      properties: ['openFile'],
      filters: [{ name: 'GGUF text model', extensions: ['gguf'] }],
    })
    if (modelResult.canceled || !modelResult.filePaths[0]) return appStore.models
    const projectorResult = await dialog.showOpenDialog({
      title: 'Select the matching mmproj GGUF vision projector',
      properties: ['openFile'],
      defaultPath: path.dirname(modelResult.filePaths[0]),
      filters: [{ name: 'GGUF vision projector (mmproj)', extensions: ['gguf'] }],
    })
    if (projectorResult.canceled || !projectorResult.filePaths[0]) return appStore.models
    const paired = await inspectVisionModelPair(
      modelResult.filePaths[0],
      projectorResult.filePaths[0],
    )
    const existing = appStore.models.find((item) => item.id === paired.id)
    if (existing) {
      appStore.models = appStore.models.map((item) =>
        item.id === paired.id
          ? {
              ...existing,
              ...paired,
              apiId: existing.apiId,
              mmprojPath: paired.mmprojPath,
              mmprojName: paired.mmprojName,
              mmprojSize: paired.mmprojSize,
            }
          : item,
      )
      send('models:updated', appStore.models)
    } else {
      mergeModels([paired])
    }
    return appStore.models
  })
  ipcMain.handle('models:choose-projector', async (_event, modelId: string) => {
    const model = appStore.models.find((item) => item.id === modelId)
    if (!model) throw new Error('The selected model is no longer available')
    const result = await dialog.showOpenDialog({
      title: `Select the mmproj GGUF for ${model.name}`,
      properties: ['openFile'],
      defaultPath: path.dirname(model.path),
      filters: [{ name: 'GGUF vision projector (mmproj)', extensions: ['gguf'] }],
    })
    if (result.canceled || !result.filePaths[0]) return appStore.models
    const projector = await inspectGguf(result.filePaths[0])
    const paired = pairVisionProjector(model, projector)
    appStore.models = appStore.models.map((item) => (item.id === modelId ? paired : item))
    send('models:updated', appStore.models)
    return appStore.models
  })
  ipcMain.handle('models:clear-projector', (_event, modelId: string) => {
    let found = false
    appStore.models = appStore.models.map((item) => {
      if (item.id !== modelId) return item
      found = true
      const next = { ...item }
      delete next.mmprojPath
      delete next.mmprojName
      delete next.mmprojSize
      return next
    })
    if (!found) throw new Error('The selected model is no longer available')
    send('models:updated', appStore.models)
    return appStore.models
  })
  ipcMain.handle('models:choose-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add model directory',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return appStore.models
    const settings = appStore.settings
    if (!settings.modelDirectories.includes(result.filePaths[0])) {
      settings.modelDirectories.push(result.filePaths[0])
      appStore.settings = settings
    }
    return rescanModels()
  })

  ipcMain.handle('models:choose-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Model Folder',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return appStore.models
    const folder = result.filePaths[0]
    const settings = appStore.settings
    if (!settings.modelDirectories.includes(folder)) {
      settings.modelDirectories.push(folder)
      appStore.settings = settings
    }
    return rescanModels()
  })

  ipcMain.handle('models:remove-folder', async (_event, folder: string) => {
    const settings = appStore.settings
    settings.modelDirectories = settings.modelDirectories.filter((f) => f !== folder)
    appStore.settings = settings
    return rescanModels()
  })

  ipcMain.handle('models:remove', (_event, id: string) => {
    appStore.models = appStore.models.filter((model) => model.id !== id)
    return appStore.models
  })
  ipcMain.handle('models:get-template', async (_event, id: string) => {
    const model = appStore.models.find((item) => item.id === id)
    if (!model) throw new Error('The selected model is no longer available')
    return readGgufChatTemplate(model.path)
  })

  ipcMain.handle(
    'files:choose-auxiliary',
    async (
      _event,
      kind: 'mmproj' | 'draft' | 'lora' | 'grammar' | 'template' | 'directory',
    ) => {
      if (kind === 'directory') {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
        return result.canceled ? '' : (result.filePaths[0] ?? '')
      }
      const extensions =
        kind === 'grammar'
          ? ['gbnf', 'txt']
          : kind === 'template'
            ? ['jinja', 'j2', 'txt']
            : ['gguf']
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: `${kind} files`, extensions }],
      })
      return result.canceled ? '' : (result.filePaths[0] ?? '')
    },
  )

  ipcMain.handle('files:choose-images', async (): Promise<Attachment[]> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (result.canceled) return []
    return Promise.all(
      result.filePaths.map((filePath) =>
        copyImageAttachment(filePath, attachmentsDirectory),
      ),
    )
  })

  ipcMain.handle('chats:load', (_event, id: string) => appStore.loadChat(id))
  ipcMain.handle('chats:save', async (_event, chat: ChatSession) => {
    const saved = await appStore.saveChat(chat)
    return { chat: saved, chats: appStore.chats }
  })
  ipcMain.handle('chats:delete', async (_event, id: string) => {
    await appStore.deleteChat(id)
    return appStore.chats
  })

  ipcMain.handle('server:start', async (_event, modelId: string, config: LoadConfig) => {
    const model = appStore.models.find((item) => item.id === modelId)
    if (!model) throw new Error('The selected model is no longer available')
    if (model.validationError) throw new Error(model.validationError)
    const projectorPath = model.mmprojPath || config.mmprojPath
    if (projectorPath && !existsSync(projectorPath)) {
      throw new Error('The paired mmproj vision projector is missing. Select it again in My Models.')
    }
    return serverManager.start(model, gatewayProtectedConfig(config))
  })
  ipcMain.handle('server:stop', () => serverManager.stop())
  ipcMain.handle('server:release-memory', () => serverManager.releaseMemory())
  ipcMain.handle('server:status', () => serverManager.currentStatus())
  ipcMain.handle('server:logs', () => serverManager.getLogs())
  ipcMain.handle('admin:dashboard', () =>
    apiAccess.dashboard(apiGateway.currentStatus()),
  )
  ipcMain.handle('admin:create-api-key', (_event, input: CreateApiKeyInput) => {
    const generated = apiAccess.createKey(input, appStore.settings.apiGateway)
    send('admin:updated', apiAccess.dashboard(apiGateway.currentStatus()))
    return generated
  })
  ipcMain.handle('admin:revoke-api-key', (_event, id: string) => {
    const key = apiAccess.revokeKey(id)
    send('admin:updated', apiAccess.dashboard(apiGateway.currentStatus()))
    return key
  })
  ipcMain.handle('chat:start', (_event, request: ChatRequest) => serverManager.chat(request))
  ipcMain.handle('chat:cancel', (_event, requestId: string) => serverManager.cancelChat(requestId))

  ipcMain.handle('hf:search', (_event, query: string) => huggingFace.search(query))
  ipcMain.handle('hf:detail', (_event, repoId: string) => huggingFace.detail(repoId))
  ipcMain.handle(
    'hf:download',
    (
      _event,
      repoId: string,
      fileName: string,
      expectedSize?: number,
      sha256?: string,
    ) => ({
      id: huggingFace.startDownload(repoId, fileName, expectedSize, sha256),
    }),
  )
  ipcMain.handle('hf:cancel', (_event, id: string) => huggingFace.cancel(id))

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      throw new Error('Only web links can be opened')
    }
    await shell.openExternal(url)
  })
  ipcMain.handle('shell:show-item', (_event, filePath: string) => shell.showItemInFolder(filePath))
}

function mergeModels(
  models: Awaited<ReturnType<typeof scanModelPaths>>,
  replaceDirectories: string[] = [],
) {
  const retained = appStore.models.filter(
    (model) =>
      !replaceDirectories.some((directory) => isPathWithin(model.path, directory)),
  )
  const merged = new Map(retained.map((model) => [model.id, model]))
  for (const model of models) {
    const existing = merged.get(model.id)
    const persistedProjector =
      existing?.mmprojPath && existsSync(existing.mmprojPath)
        ? {
            mmprojPath: existing.mmprojPath,
            mmprojName: existing.mmprojName,
            mmprojSize: existing.mmprojSize,
            capabilities: { ...model.capabilities, vision: true },
          }
        : {}
    merged.set(model.id, { ...existing, ...model, ...persistedProjector })
  }
  appStore.models = [...merged.values()]
    .filter((model) => !model.fileName.toLowerCase().includes('mmproj'))
    .map((model) => {
      if (model.apiId) return model
      const baseName = path
        .basename(model.fileName, path.extname(model.fileName))
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 72)
      return { ...model, apiId: `${baseName || 'model'}-${model.id.slice(0, 7)}` }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  send('models:updated', appStore.models)
}

async function rescanModels() {
  const settings = appStore.settings
  const models = await scanModelPaths(settings.modelDirectories)
  mergeModels(models, settings.modelDirectories)
  return appStore.models
}

function isPathWithin(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function gatewayProtectedConfig(config: LoadConfig): LoadConfig {
  if (!appStore.settings.apiGateway.enabled || config.apiKey) return config
  return {
    ...config,
    apiKey: `llama_internal_${randomBytes(32).toString('base64url')}`,
  }
}

app.whenReady().then(async () => {
  // Without an explicit AppUserModelID Windows groups the window under the
  // generic Electron entry and shows its icon in the taskbar instead of ours.
  if (process.platform === 'win32') app.setAppUserModelId('com.llamaaistudio.app')

  const defaultModelDirectory = path.join(app.getPath('userData'), 'models')
  attachmentsDirectory = path.join(app.getPath('userData'), 'attachments')
  await mkdir(defaultModelDirectory, { recursive: true })
  await mkdir(attachmentsDirectory, { recursive: true })

  const storeDefaults = {
    settings: makeDefaultSettings(defaultModelDirectory),
    models: [],
    chats: [
      {
        id: crypto.randomUUID(),
        title: 'New conversation',
        folder: '',
        systemPrompt: '',
        messages: [],
        sampling: { ...defaultSampling },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  }
  appStore = new AppStore(storeDefaults, app.getPath('userData'))
  await appStore.initialize()

  protocol.handle('forge-file', async (request) => {
    const filePath = resolveAttachmentRequest(request.url, attachmentsDirectory)
    if (!filePath) return new Response('Not found', { status: 404 })
    try {
      const mimeType = imageMimeType(filePath)
      if (!mimeType) return new Response('Unsupported type', { status: 415 })
      return new Response(await readFile(filePath), {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  runtimeManager = new RuntimeManager(
    appStore.settings.runtimePath,
    path.join(app.getPath('userData'), 'runtimes'),
    (runtime) => send('runtime:progress', runtime),
  )
  serverManager = new ServerManager(
    () => runtimeManager.path,
    () => appStore.models,
    path.join(app.getPath('userData'), 'router', 'models.ini'),
    attachmentsDirectory,
    (status) => send('server:status-changed', status),
    (line) => send('server:log', line),
    (chunk) => send('chat:chunk', chunk),
  )
  apiAccess = new ApiAccessStore(path.join(app.getPath('userData'), 'api-gateway'))
  await apiAccess.initialize()
  apiGateway = new ApiGateway(
    () => appStore.settings.apiGateway,
    () => serverManager.gatewayTarget(),
    apiAccess,
    () => send('admin:updated', apiAccess.dashboard(apiGateway.currentStatus())),
  )
  huggingFace = new HuggingFaceService(
    () => appStore.getHfToken(),
    () => appStore.settings.downloadDirectory,
    (progress) => {
      send('hf:progress', progress)
      if (progress.state === 'completed') void rescanModels()
    },
  )
  registerIpc()
  createWindow()
  await apiGateway.start()
  const models = await rescanModels()
  modelScanner.watchFolders(appStore.settings.modelDirectories, () => {
    void rescanModels()
  })
  const firstLoadableModel = models.find((model) => !model.validationError)
  if (
    appStore.settings.startServerOnLaunch &&
    firstLoadableModel &&
    (await runtimeManager.info()).exists
  ) {
    void serverManager
      .start(firstLoadableModel, gatewayProtectedConfig(appStore.settings.defaultLoadConfig))
      .catch((error) =>
        send(
          'server:log',
          `[auto-start failed] ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  modelScanner.stopWatching()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void serverManager?.stop()
  void apiGateway?.stop()
  void apiAccess?.flush()
})
