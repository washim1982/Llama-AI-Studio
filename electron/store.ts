import Store from 'electron-store'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { AppSettings, ChatSession, ChatSummary, GgufModel } from '../src/types'
import { migrateServerPort } from './defaults'
import { ChatFileStore } from './chatStore'

interface PersistedData {
  settings: AppSettings
  models: GgufModel[]
  chats: ChatSession[]
  encryptedHfToken?: string
}

export class AppStore {
  private readonly store: Store<PersistedData>
  private readonly defaults: PersistedData
  private readonly chatFiles: ChatFileStore

  constructor(defaults: PersistedData, userDataDirectory: string) {
    this.defaults = defaults
    this.store = new Store<PersistedData>({
      name: 'llama-forge-data',
      defaults: { ...defaults, chats: [] },
    })
    this.chatFiles = new ChatFileStore(
      path.join(userDataDirectory, 'chats'),
      path.join(userDataDirectory, 'attachments'),
    )
  }

  async initialize(): Promise<void> {
    const legacyChats = this.store.get('chats', [])
    const { legacyMigrated } = await this.chatFiles.initialize(
      legacyChats,
      this.defaults.chats,
    )
    if (legacyMigrated || !legacyChats.length) this.store.delete('chats')

    const storedModels = this.store.get('models', [])
    let modelsChanged = false
    const compactModels = storedModels.map((model) => {
      const legacyTemplate =
        model.chatTemplate ??
        Object.entries(model.metadata).find(([key]) => key.includes('chat_template'))?.[1]
      const metadata = Object.fromEntries(
        Object.entries(model.metadata).filter(([key]) => !key.includes('chat_template')),
      )
      if (legacyTemplate || Object.keys(metadata).length !== Object.keys(model.metadata).length) {
        modelsChanged = true
        const rest = { ...model }
        delete rest.chatTemplate
        return {
          ...rest,
          hasChatTemplate: model.hasChatTemplate ?? Boolean(legacyTemplate),
          metadata,
        }
      }
      return model
    })
    if (modelsChanged) this.store.set('models', compactModels)
  }

  get settings(): AppSettings {
    const stored = this.store.get('settings')
    const defaultLoadConfig = {
      ...this.defaults.settings.defaultLoadConfig,
      ...stored.defaultLoadConfig,
    }
    return {
      ...this.defaults.settings,
      ...stored,
      huggingFaceToken: this.getHfToken(),
      defaultLoadConfig: {
        ...defaultLoadConfig,
        port: migrateServerPort(defaultLoadConfig.port),
      },
      defaultSampling: {
        ...this.defaults.settings.defaultSampling,
        ...stored.defaultSampling,
      },
      presets: stored.presets ?? this.defaults.settings.presets,
    }
  }

  set settings(value: AppSettings) {
    if (value.huggingFaceToken && safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(value.huggingFaceToken).toString('base64')
        this.store.set('encryptedHfToken', encrypted)
      } catch {
        // Fall back to plain settings
      }
    }
    const copy = { ...value, huggingFaceToken: '' }
    this.store.set('settings', copy)
  }

  getHfToken(): string {
    const encrypted = this.store.get('encryptedHfToken')
    if (encrypted && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      } catch {
        return ''
      }
    }
    return this.store.get('settings')?.huggingFaceToken ?? ''
  }

  get models(): GgufModel[] {
    return this.store.get('models', [])
  }

  set models(value: GgufModel[]) {
    this.store.set('models', value)
  }

  get chats(): ChatSummary[] {
    return this.chatFiles.list()
  }

  loadChat(id: string): Promise<ChatSession> {
    return this.chatFiles.load(id)
  }

  saveChat(chat: ChatSession): Promise<ChatSession> {
    return this.chatFiles.save(chat)
  }

  deleteChat(id: string): Promise<void> {
    return this.chatFiles.delete(id)
  }
}
