import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Attachment, ChatSession } from '../src/types'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
}

export function isPathWithin(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function imageMimeType(filePath: string): string | undefined {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]
}

export async function copyImageAttachment(
  sourcePath: string,
  attachmentsDirectory: string,
): Promise<Attachment> {
  const extension = path.extname(sourcePath).toLowerCase()
  const mimeType = MIME_BY_EXTENSION[extension]
  if (!mimeType) throw new Error(`Unsupported image type: ${extension || 'unknown'}`)
  await mkdir(attachmentsDirectory, { recursive: true })
  const id = randomUUID()
  const destination = path.join(attachmentsDirectory, `${id}${extension}`)
  await copyFile(sourcePath, destination)
  return {
    id,
    name: path.basename(sourcePath),
    mimeType,
    path: destination,
  }
}

export async function migrateChatAttachments(
  chat: ChatSession,
  attachmentsDirectory: string,
): Promise<ChatSession> {
  let changed = false
  const messages = await Promise.all(
    chat.messages.map(async (message) => {
      if (!message.attachments?.length) return message
      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          if (attachment.path || !attachment.dataUrl) return attachment
          const parsed = parseDataUrl(attachment.dataUrl)
          if (!parsed) return attachment
          await mkdir(attachmentsDirectory, { recursive: true })
          const id = attachment.id || randomUUID()
          const destination = path.join(
            attachmentsDirectory,
            `${safeAttachmentId(id)}${parsed.extension}`,
          )
          await writeFile(destination, parsed.data)
          const verified = await readFile(destination)
          if (!verified.equals(parsed.data)) {
            throw new Error(`Attachment migration verification failed for ${attachment.name}`)
          }
          changed = true
          return {
            ...attachment,
            id,
            mimeType: parsed.mimeType,
            path: destination,
            dataUrl: undefined,
          }
        }),
      )
      return { ...message, attachments }
    }),
  )
  return changed ? { ...chat, messages } : chat
}

export async function attachmentDataUrl(
  attachment: Attachment,
  attachmentsDirectory: string,
): Promise<string> {
  if (attachment.dataUrl) return attachment.dataUrl
  if (!attachment.path || !isPathWithin(attachment.path, attachmentsDirectory)) {
    throw new Error(`Attachment path is outside the managed attachment directory`)
  }
  const mimeType = imageMimeType(attachment.path)
  if (!mimeType || mimeType !== attachment.mimeType) {
    throw new Error(`Attachment type is not supported`)
  }
  const data = await readFile(attachment.path)
  return `data:${mimeType};base64,${data.toString('base64')}`
}

export function resolveAttachmentRequest(
  requestUrl: string,
  attachmentsDirectory: string,
): string | undefined {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'forge-file:' || url.hostname !== 'attachment') return undefined
    const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    if (
      !fileName ||
      path.basename(fileName) !== fileName ||
      !/^[a-zA-Z0-9._-]+$/.test(fileName)
    ) {
      return undefined
    }
    const candidate = path.resolve(attachmentsDirectory, fileName)
    if (!isPathWithin(candidate, attachmentsDirectory) || !imageMimeType(candidate)) {
      return undefined
    }
    return candidate
  } catch {
    return undefined
  }
}

function safeAttachmentId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  return safe || randomUUID()
}

function parseDataUrl(
  dataUrl: string,
): { data: Buffer; extension: string; mimeType: string } | undefined {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/)
  if (!match) return undefined
  const mimeType = match[1].toLowerCase()
  const extension = EXTENSION_BY_MIME[mimeType]
  if (!extension) return undefined
  const data = Buffer.from(match[2], 'base64')
  if (!data.length) return undefined
  return { data, extension, mimeType }
}
