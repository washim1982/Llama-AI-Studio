import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultSampling } from './defaults'
import {
  attachmentDataUrl,
  migrateChatAttachments,
  resolveAttachmentRequest,
} from './attachments'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('attachment storage', () => {
  it('migrates a legacy data URL to a verified managed file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'forge-attachments-'))
    directories.push(directory)
    const bytes = Buffer.from('fixture image bytes')
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
    const migrated = await migrateChatAttachments(
      {
        id: 'chat',
        title: 'Chat',
        folder: '',
        systemPrompt: '',
        sampling: defaultSampling,
        createdAt: 1,
        updatedAt: 1,
        messages: [
          {
            id: 'message',
            role: 'user',
            content: 'image',
            createdAt: 1,
            attachments: [
              {
                id: 'legacy',
                name: 'legacy.png',
                mimeType: 'image/png',
                dataUrl,
              },
            ],
          },
        ],
      },
      directory,
    )
    const attachment = migrated.messages[0].attachments?.[0]
    expect(attachment?.dataUrl).toBeUndefined()
    expect(await readFile(attachment?.path ?? '')).toEqual(bytes)
    expect(await attachmentDataUrl(attachment!, directory)).toBe(dataUrl)
  })

  it('confines protocol requests to the managed directory', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'forge-attachments-'))
    directories.push(directory)
    expect(
      resolveAttachmentRequest('forge-file://attachment/image.png', directory),
    ).toBe(path.join(directory, 'image.png'))
    expect(
      resolveAttachmentRequest('forge-file://attachment/..%2Fsecret.png', directory),
    ).toBeUndefined()
    expect(
      resolveAttachmentRequest('forge-file://attachment/not-image.txt', directory),
    ).toBeUndefined()
  })
})
