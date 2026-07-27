import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash, randomUUID } from 'node:crypto'
import type {
  DownloadProgress,
  HfFile,
  HfModelDetail,
  HfModelSummary,
} from '../src/types'

interface HfSibling {
  rfilename: string
  size?: number
  lfs?: { size?: number; sha256?: string }
}

interface HfApiModel {
  id: string
  author?: string
  downloads?: number
  likes?: number
  lastModified?: string
  tags?: string[]
  pipeline_tag?: string
  cardData?: {
    model_name?: string
    language?: string | string[]
    license?: string
  }
  siblings?: HfSibling[]
}

export class HuggingFaceService {
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly getToken: () => string,
    private readonly getDownloadDirectory: () => string,
    private readonly onProgress: (progress: DownloadProgress) => void,
  ) {}

  async search(query: string): Promise<HfModelSummary[]> {
    const params = new URLSearchParams({
      search: query.trim(),
      filter: 'gguf',
      sort: 'downloads',
      direction: '-1',
      limit: '40',
      full: 'true',
    })
    const models = await this.request<HfApiModel[]>(`https://huggingface.co/api/models?${params}`)
    return models
      .filter((model) => model.id?.includes('/'))
      .map(toSummary)
  }

  async detail(repoId: string): Promise<HfModelDetail> {
    assertRepoId(repoId)
    const model = await this.request<HfApiModel>(
      `https://huggingface.co/api/models/${encodeRepo(repoId)}`,
    )
    let readme = ''
    try {
      const readmeResponse = await fetch(
        `https://huggingface.co/${encodeRepo(repoId)}/raw/main/README.md`,
        { headers: this.headers() },
      )
      if (readmeResponse.ok) readme = await readmeResponse.text()
    } catch {
      // A missing model card does not prevent model downloads.
    }
    const files = (model.siblings ?? [])
      .filter((file) => file.rfilename.toLowerCase().endsWith('.gguf'))
      .map((file) => toFile(file))
      .sort((a, b) => {
        if (a.isMmproj !== b.isMmproj) return a.isMmproj ? 1 : -1
        return a.size - b.size
      })
    const summary = toSummary(model)
    return {
      ...summary,
      description:
        model.cardData?.model_name ??
        `${summary.name} is a GGUF repository published by ${summary.author}.`,
      readme,
      files,
    }
  }

  startDownload(
    repoId: string,
    fileName: string,
    expectedSize = 0,
    expectedSha256 = '',
  ): string {
    assertRepoId(repoId)
    assertFileName(fileName)
    const id = randomUUID()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    void this.download(
      id,
      repoId,
      fileName,
      controller,
      expectedSize,
      expectedSha256.toLowerCase(),
    )
    return id
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort()
  }

  private async download(
    id: string,
    repoId: string,
    fileName: string,
    controller: AbortController,
    expectedSize: number,
    expectedSha256: string,
  ) {
    const modelDirectory = path.join(
      this.getDownloadDirectory(),
      ...repoId.split('/').map(safeSegment),
    )
    const destination = path.join(modelDirectory, path.basename(fileName))
    const partial = `${destination}.partial`
    try {
      await mkdir(modelDirectory, { recursive: true })
      try {
        const completed = await stat(destination)
        if (!expectedSize || completed.size === expectedSize) {
          if (expectedSha256) {
            this.onProgress({
              id,
              repoId,
              fileName,
              received: completed.size,
              total: expectedSize || completed.size,
              percent: 100,
              state: 'verifying',
              message: 'Verifying existing download…',
              destination,
            })
            if ((await hashFile(destination)) === expectedSha256) {
              this.onProgress({
                id,
                repoId,
                fileName,
                received: completed.size,
                total: expectedSize || completed.size,
                percent: 100,
                state: 'completed',
                message: 'Existing download verified',
                destination,
              })
              return
            }
          } else if (expectedSize) {
            this.onProgress({
              id,
              repoId,
              fileName,
              received: completed.size,
              total: expectedSize,
              percent: 100,
              state: 'completed',
              message: 'Existing download size verified',
              destination,
            })
            return
          }
        }
        await rm(destination, { force: true })
      } catch {
        // No completed destination exists yet.
      }

      let existing = 0
      try {
        existing = (await stat(partial)).size
      } catch {
        existing = 0
      }
      if (expectedSize && existing >= expectedSize) {
        if (existing > expectedSize) {
          await rm(partial, { force: true })
          existing = 0
        } else {
          let verified = true
          if (expectedSha256) {
            this.onProgress({
              id,
              repoId,
              fileName,
              received: existing,
              total: expectedSize,
              percent: 100,
              state: 'verifying',
              message: 'Verifying completed partial download…',
              destination,
            })
            verified = (await hashFile(partial)) === expectedSha256
          }
          if (verified) {
            await rename(partial, destination)
            this.onProgress({
              id,
              repoId,
              fileName,
              received: existing,
              total: expectedSize,
              percent: 100,
              state: 'completed',
              message: 'Download verified',
              destination,
            })
            return
          }
          await rm(partial, { force: true })
          existing = 0
        }
      }
      const headers = this.headers()
      if (existing > 0) headers.Range = `bytes=${existing}-`
      let response = await fetch(
        `https://huggingface.co/${encodeRepo(repoId)}/resolve/main/${encodeFile(fileName)}?download=true`,
        {
          headers,
          signal: controller.signal,
          redirect: 'follow',
        },
      )
      if ((!response.ok && response.status !== 206) || !response.body) {
        throw new Error(`Hugging Face returned ${response.status}`)
      }
      if (existing > 0 && response.status === 200) {
        await rm(partial, { force: true })
        existing = 0
      }
      if (existing > 0 && response.status === 206) {
        const range = parseContentRange(response.headers.get('content-range'))
        if (!range || range.start !== existing) {
          await response.body.cancel()
          await rm(partial, { force: true })
          existing = 0
          response = await fetch(
            `https://huggingface.co/${encodeRepo(repoId)}/resolve/main/${encodeFile(fileName)}?download=true`,
            {
              headers: this.headers(),
              signal: controller.signal,
              redirect: 'follow',
            },
          )
          if (!response.ok || !response.body) {
            throw new Error(`Hugging Face restart returned ${response.status}`)
          }
        }
      }
      const responseLength = Number(response.headers.get('content-length')) || 0
      const contentRange = parseContentRange(response.headers.get('content-range'))
      const reportedTotal = contentRange?.total ?? existing + responseLength
      if (expectedSize && reportedTotal && reportedTotal !== expectedSize) {
        throw new Error(
          `Repository file size changed (expected ${expectedSize}, received ${reportedTotal}). Refresh the model page and retry.`,
        )
      }
      const total = expectedSize || reportedTotal
      let received = existing
      this.onProgress({
        id,
        repoId,
        fileName,
        received,
        total,
        percent: total ? (received / total) * 100 : 0,
        state: 'downloading',
        destination,
      })

      const source = Readable.fromWeb(response.body as never)
      source.on('data', (chunk: Buffer) => {
        received += chunk.length
        this.onProgress({
          id,
          repoId,
          fileName,
          received,
          total,
          percent: total ? Math.min(100, (received / total) * 100) : 0,
          state: 'downloading',
          destination,
        })
      })
      await pipeline(source, createWriteStream(partial, { flags: existing > 0 ? 'a' : 'w' }))
      const completed = await stat(partial)
      if (total && completed.size !== total) {
        throw new Error(
          `Incomplete download: expected ${total} bytes but received ${completed.size}. Retry will resume safely.`,
        )
      }
      if (expectedSha256) {
        this.onProgress({
          id,
          repoId,
          fileName,
          received: completed.size,
          total: total || completed.size,
          percent: 100,
          state: 'verifying',
          message: 'Verifying SHA-256 checksum…',
          destination,
        })
        const actualSha256 = await hashFile(partial)
        if (actualSha256 !== expectedSha256) {
          await rm(partial, { force: true })
          throw new Error(
            `Checksum verification failed. Expected ${expectedSha256}, received ${actualSha256}. The corrupt partial download was removed; retry the download.`,
          )
        }
      }
      await rename(partial, destination)
      this.onProgress({
        id,
        repoId,
        fileName,
        received,
        total: total || received,
        percent: 100,
        state: 'completed',
        destination,
      })
    } catch (error) {
      this.onProgress({
        id,
        repoId,
        fileName,
        received: 0,
        total: 0,
        percent: 0,
        state: controller.signal.aborted ? 'cancelled' : 'error',
        message: error instanceof Error ? error.message : String(error),
        destination,
      })
    } finally {
      this.controllers.delete(id)
    }
  }

  private async request<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: this.headers() })
    if (!response.ok) throw new Error(`Hugging Face returned ${response.status}`)
    return (await response.json()) as T
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'Llama-Forge-Studio',
    }
    const token = this.getToken().trim()
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }
}

function toSummary(model: HfApiModel): HfModelSummary {
  const [author = 'community', ...nameParts] = model.id.split('/')
  return {
    id: model.id,
    author: model.author ?? author,
    name: model.cardData?.model_name ?? nameParts.join('/') ?? model.id,
    downloads: model.downloads ?? 0,
    likes: model.likes ?? 0,
    lastModified: model.lastModified ?? '',
    tags: model.tags ?? [],
    pipelineTag: model.pipeline_tag,
  }
}

function toFile(file: HfSibling): HfFile {
  const name = file.rfilename
  return {
    name,
    size: file.lfs?.size ?? file.size ?? 0,
    sha256: file.lfs?.sha256,
    quantization:
      name.match(/(?:^|[-_.])((?:IQ|Q|TQ|BF|F)\d(?:_[A-Z0-9]+)*)(?:[-_.]|$)/i)?.[1]?.toUpperCase() ??
      'Unknown',
    isMmproj: path.basename(name).toLowerCase().includes('mmproj'),
  }
}

export function parseContentRange(
  value: string | null,
): { start: number; end: number; total: number } | undefined {
  const match = value?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  if (!match) return undefined
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: Number(match[3]),
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function assertRepoId(repoId: string) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoId)) throw new Error('Invalid Hugging Face repository')
}

function assertFileName(fileName: string) {
  if (!fileName.toLowerCase().endsWith('.gguf') || fileName.includes('..')) {
    throw new Error('Only GGUF files can be downloaded')
  }
}

function encodeRepo(repoId: string): string {
  return repoId.split('/').map(encodeURIComponent).join('/')
}

function encodeFile(fileName: string): string {
  return fileName.split('/').map(encodeURIComponent).join('/')
}

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
}
