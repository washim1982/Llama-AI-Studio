import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSampling } from './defaults'
import { ChatFileStore } from './chatStore'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('ChatFileStore', () => {
  it('splits legacy chats into files and keeps only summaries in memory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'forge-chats-'))
    directories.push(root)
    const chatsDirectory = path.join(root, 'chats')
    const store = new ChatFileStore(chatsDirectory, path.join(root, 'attachments'))
    const chat = {
      id: 'legacy-chat',
      title: 'Legacy chat',
      folder: 'Imported',
      systemPrompt: '',
      sampling: defaultSampling,
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { id: 'message', role: 'user' as const, content: 'Hello', createdAt: 1 },
      ],
    }

    expect(await store.initialize([chat], [])).toEqual({ legacyMigrated: true })
    expect(store.list()).toEqual([
      expect.objectContaining({
        id: chat.id,
        title: chat.title,
        messageCount: 1,
      }),
    ])
    expect(await store.load(chat.id)).toEqual(chat)
    expect((await readdir(chatsDirectory)).filter((file) => file.endsWith('.json'))).toHaveLength(1)

    await store.delete(chat.id)
    expect(store.list()).toEqual([])
  })
})
