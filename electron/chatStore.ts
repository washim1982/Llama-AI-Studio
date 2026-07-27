import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatSession, ChatSummary } from '../src/types'
import { isPathWithin, migrateChatAttachments } from './attachments'

interface IndexedChat {
  summary: ChatSummary
  filePath: string
}

export class ChatFileStore {
  private readonly index = new Map<string, IndexedChat>()
  private readonly pendingSaves = new Map<string, Promise<ChatSession>>()

  constructor(
    private readonly chatsDirectory: string,
    private readonly attachmentsDirectory: string,
  ) {}

  async initialize(
    legacyChats: ChatSession[],
    defaultChats: ChatSession[],
  ): Promise<{ legacyMigrated: boolean }> {
    await mkdir(this.chatsDirectory, { recursive: true })
    await mkdir(this.attachmentsDirectory, { recursive: true })
    await this.readIndex()

    for (const chat of legacyChats) {
      if (!this.index.has(chat.id)) await this.save(chat)
    }
    if (!this.index.size) {
      for (const chat of defaultChats) await this.save(chat)
    }

    const legacyMigrated =
      legacyChats.length > 0 && legacyChats.every((chat) => this.index.has(chat.id))
    return { legacyMigrated }
  }

  list(): ChatSummary[] {
    return [...this.index.values()]
      .map(({ summary }) => ({ ...summary }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string): Promise<ChatSession> {
    const indexed = this.index.get(id)
    if (!indexed) throw new Error('The selected conversation no longer exists')
    const chat = await readChat(indexed.filePath)
    if (!chat || chat.id !== id) throw new Error('The conversation file is invalid')
    return chat
  }

  save(chat: ChatSession): Promise<ChatSession> {
    const previous = this.pendingSaves.get(chat.id)
    const pending = (previous?.catch(() => undefined) ?? Promise.resolve()).then(
      () => this.saveNow(chat),
    )
    this.pendingSaves.set(chat.id, pending)
    void pending.then(
      () => {
        if (this.pendingSaves.get(chat.id) === pending) this.pendingSaves.delete(chat.id)
      },
      () => {
        if (this.pendingSaves.get(chat.id) === pending) this.pendingSaves.delete(chat.id)
      },
    )
    return pending
  }

  private async saveNow(chat: ChatSession): Promise<ChatSession> {
    const migrated = await migrateChatAttachments(chat, this.attachmentsDirectory)
    const filePath = this.filePathForId(migrated.id)
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`
    const json = JSON.stringify(migrated)
    await writeFile(temporaryPath, json, 'utf8')
    const verified = await readChat(temporaryPath)
    if (!verified || verified.id !== migrated.id) {
      await rm(temporaryPath, { force: true })
      throw new Error('Conversation save verification failed')
    }
    const backupPath = `${filePath}.${randomUUID()}.bak`
    let backedUp = false
    try {
      await rename(filePath, backupPath)
      backedUp = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(temporaryPath, filePath)
      await rm(backupPath, { force: true })
    } catch (error) {
      if (backedUp) await rename(backupPath, filePath)
      await rm(temporaryPath, { force: true })
      throw error
    }
    this.index.set(migrated.id, {
      summary: summarizeChat(migrated),
      filePath,
    })
    return migrated
  }

  async delete(id: string): Promise<void> {
    await this.pendingSaves.get(id)?.catch(() => undefined)
    const indexed = this.index.get(id)
    if (!indexed) return
    const chat = await readChat(indexed.filePath)
    await rm(indexed.filePath, { force: true })
    this.index.delete(id)
    if (!chat) return

    const remainingReferences = new Set<string>()
    for (const entry of this.index.values()) {
      const remaining = await readChat(entry.filePath)
      for (const attachmentPath of attachmentPaths(remaining)) {
        remainingReferences.add(path.resolve(attachmentPath).toLowerCase())
      }
    }
    for (const attachmentPath of attachmentPaths(chat)) {
      const resolved = path.resolve(attachmentPath)
      if (
        isPathWithin(resolved, this.attachmentsDirectory) &&
        !remainingReferences.has(resolved.toLowerCase())
      ) {
        await rm(resolved, { force: true })
      }
    }
  }

  private async readIndex() {
    let entries: string[] = []
    try {
      entries = await readdir(this.chatsDirectory)
    } catch {
      return
    }
    for (const fileName of entries.filter((entry) => entry.endsWith('.json'))) {
      const filePath = path.join(this.chatsDirectory, fileName)
      const chat = await readChat(filePath)
      if (!chat) continue
      this.index.set(chat.id, { summary: summarizeChat(chat), filePath })
    }
  }

  private filePathForId(id: string): string {
    const key = createHash('sha256').update(id).digest('hex')
    return path.join(this.chatsDirectory, `${key}.json`)
  }
}

export function summarizeChat(chat: ChatSession): ChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    folder: chat.folder,
    modelId: chat.modelId,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  }
}

async function readChat(filePath: string): Promise<ChatSession | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<ChatSession>
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.messages) ||
      !parsed.sampling
    ) {
      return undefined
    }
    return parsed as ChatSession
  } catch {
    return undefined
  }
}

function attachmentPaths(chat?: ChatSession): string[] {
  if (!chat) return []
  return chat.messages.flatMap(
    (message) =>
      message.attachments
        ?.map((attachment) => attachment.path)
        .filter((value): value is string => Boolean(value)) ?? [],
  )
}
