import { randomUUID } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type {
  ApiGatewaySettings,
  ApiGatewayStatus,
  ApiKeyRecord,
  ApiTrace,
  ApiTraceEvent,
} from '../src/types'
import { ApiAccessStore } from './apiAccess'

const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const MAX_OBSERVED_RESPONSE_BYTES = 2 * 1024 * 1024
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface ApiGatewayTarget {
  url: string
  apiKey: string
  running: boolean
}

export class ApiGateway {
  private server?: Server
  private status: ApiGatewayStatus

  constructor(
    private readonly getSettings: () => ApiGatewaySettings,
    private readonly getTarget: () => ApiGatewayTarget,
    private readonly access: ApiAccessStore,
    private readonly onChanged: () => void,
  ) {
    const settings = getSettings()
    this.status = makeStatus('stopped', settings.host, settings.port)
  }

  currentStatus(): ApiGatewayStatus {
    return { ...this.status }
  }

  async start(): Promise<ApiGatewayStatus> {
    const settings = this.getSettings()
    if (!settings.enabled) {
      this.status = makeStatus('stopped', settings.host, settings.port)
      this.onChanged()
      return this.currentStatus()
    }
    if (this.server) return this.currentStatus()
    this.status = makeStatus('starting', settings.host, settings.port)
    this.onChanged()
    try {
      this.server = createServer((request, response) => {
        void this.handle(request, response)
      })
      await listen(this.server, settings.port, settings.host)
      const address = this.server.address()
      const port = typeof address === 'object' && address ? address.port : settings.port
      this.status = makeStatus('running', settings.host, port)
      this.onChanged()
      return this.currentStatus()
    } catch (error) {
      this.server?.close()
      this.server = undefined
      this.status = {
        ...makeStatus('error', settings.host, settings.port),
        error: error instanceof Error ? error.message : String(error),
      }
      this.onChanged()
      return this.currentStatus()
    }
  }

  async restart(): Promise<ApiGatewayStatus> {
    await this.stop()
    return this.start()
  }

  async stop(): Promise<ApiGatewayStatus> {
    const server = this.server
    this.server = undefined
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    const settings = this.getSettings()
    this.status = makeStatus('stopped', settings.host, settings.port)
    this.onChanged()
    return this.currentStatus()
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    applyCors(response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const requestUrl = new URL(request.url ?? '/', 'http://gateway.local')
    if (request.method === 'GET' && (requestUrl.pathname === '/health' || requestUrl.pathname === '/gateway/health')) {
      const target = this.getTarget()
      sendJson(response, target.running ? 200 : 503, {
        status: target.running ? 'ok' : 'upstream unavailable',
        gateway: this.status.state,
      })
      return
    }

    const startedAt = Date.now()
    const requestId = safeRequestId(request.headers['x-request-id'])
    const endpoint = describeEndpoint(request.method ?? 'GET', requestUrl.pathname)
    const clientIp = readClientIp(request)
    const events: ApiTraceEvent[] = []
    const secret = bearerToken(request.headers.authorization) ?? firstHeader(request.headers['x-api-key'])
    const apiKey = secret ? this.access.authenticate(secret) : undefined
    if (!apiKey) {
      sendJson(response, 401, {
        error: { message: 'A valid API key is required', type: 'authentication_error' },
        request_id: requestId,
      }, requestId)
      this.finishTrace({
        requestId,
        apiKey,
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
        endpoint,
        status: 401,
        startedAt,
        promptTokens: 0,
        completionTokens: 0,
        streaming: false,
        clientIp,
        error: 'Invalid or missing API key',
        events: [{ name: 'failed', atMs: Date.now() - startedAt, detail: 'Authentication failed' }],
      })
      return
    }
    events.push({ name: 'authenticated', atMs: Date.now() - startedAt, detail: apiKey.prefix })

    let body: Uint8Array | undefined
    try {
      body = await readBody(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 413, { error: { message, type: 'invalid_request_error' }, request_id: requestId }, requestId)
      this.finishTrace({
        requestId,
        apiKey,
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
        endpoint,
        status: 413,
        startedAt,
        promptTokens: 0,
        completionTokens: 0,
        streaming: false,
        clientIp,
        error: message,
        events: [...events, { name: 'failed', atMs: Date.now() - startedAt, detail: message }],
      })
      return
    }

    const requestMetadata = readRequestMetadata(body, request.headers['content-type'])
    const target = this.getTarget()
    if (!target.running) {
      sendJson(response, 503, {
        error: { message: 'The inference server is not running', type: 'service_unavailable' },
        request_id: requestId,
      }, requestId)
      this.finishTrace({
        requestId,
        apiKey,
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
        endpoint,
        model: requestMetadata.model,
        status: 503,
        startedAt,
        promptTokens: 0,
        completionTokens: 0,
        streaming: requestMetadata.streaming,
        clientIp,
        error: 'Inference server unavailable',
        events: [...events, { name: 'failed', atMs: Date.now() - startedAt, detail: 'Upstream unavailable' }],
      })
      return
    }

    events.push({ name: 'upstream_started', atMs: Date.now() - startedAt, detail: target.url })
    const abortController = new AbortController()
    request.once('aborted', () => abortController.abort())
    response.once('close', () => {
      if (!response.writableEnded) abortController.abort()
    })
    const tracker = new UsageTracker()
    let status = 502
    let timeToFirstByteMs: number | undefined
    try {
      const upstream = await fetch(`${target.url}${requestUrl.pathname}${requestUrl.search}`, {
        method: request.method,
        headers: upstreamHeaders(request.headers, target.apiKey, requestId),
        body: body?.byteLength ? (body as unknown as BodyInit) : undefined,
        signal: abortController.signal,
      })
      status = upstream.status
      response.statusCode = upstream.status
      response.statusMessage = upstream.statusText
      copyResponseHeaders(upstream.headers, response)
      response.setHeader('x-request-id', requestId)
      if (!upstream.body) {
        response.end()
      } else {
        const reader = upstream.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (timeToFirstByteMs === undefined) {
            timeToFirstByteMs = Date.now() - startedAt
            events.push({ name: 'first_byte', atMs: timeToFirstByteMs })
          }
          tracker.push(value, upstream.headers.get('content-type') ?? '')
          if (!response.destroyed) response.write(Buffer.from(value))
        }
        if (!response.destroyed) response.end()
      }
      const usage = tracker.finish()
      if (usage.promptTokens || usage.completionTokens) {
        events.push({
          name: 'usage_captured',
          atMs: Date.now() - startedAt,
          detail: `${usage.promptTokens} input + ${usage.completionTokens} output tokens`,
        })
      }
      events.push({ name: 'completed', atMs: Date.now() - startedAt })
      this.finishTrace({
        requestId,
        apiKey,
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
        endpoint,
        model: requestMetadata.model,
        status,
        startedAt,
        timeToFirstByteMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        streaming: requestMetadata.streaming,
        clientIp,
        error: status >= 400 ? usage.error ?? upstream.statusText : undefined,
        events,
      })
    } catch (error) {
      const aborted = abortController.signal.aborted
      status = aborted ? 499 : 502
      const message = aborted ? 'Client disconnected' : error instanceof Error ? error.message : String(error)
      if (!response.headersSent) {
        sendJson(response, status, { error: { message, type: 'gateway_error' }, request_id: requestId }, requestId)
      } else if (!response.destroyed) {
        response.end()
      }
      events.push({ name: 'failed', atMs: Date.now() - startedAt, detail: message })
      const usage = tracker.finish()
      this.finishTrace({
        requestId,
        apiKey,
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
        endpoint,
        model: requestMetadata.model,
        status,
        startedAt,
        timeToFirstByteMs,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        streaming: requestMetadata.streaming,
        clientIp,
        error: message,
        events,
      })
    }
  }

  private finishTrace(input: {
    requestId: string
    apiKey?: ApiKeyRecord
    method: string
    path: string
    endpoint: string
    model?: string
    status: number
    startedAt: number
    timeToFirstByteMs?: number
    promptTokens: number
    completionTokens: number
    streaming: boolean
    clientIp?: string
    error?: string
    events: ApiTraceEvent[]
  }): ApiTrace {
    const durationMs = Math.max(0, Date.now() - input.startedAt)
    const trace = this.access.recordTrace({
      id: randomUUID(),
      requestId: input.requestId,
      apiKeyId: input.apiKey?.id,
      apiKeyName: input.apiKey?.userName ?? 'Unauthenticated',
      method: input.method,
      path: input.path,
      endpoint: input.endpoint,
      model: input.model,
      status: input.status,
      startedAt: input.startedAt,
      durationMs,
      timeToFirstByteMs: input.timeToFirstByteMs,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.promptTokens + input.completionTokens,
      streaming: input.streaming,
      clientIp: input.clientIp,
      error: input.error,
      events: input.events,
    })
    this.onChanged()
    return trace
  }
}

interface CapturedUsage {
  promptTokens: number
  completionTokens: number
  error?: string
}

export class UsageTracker {
  private decoder = new TextDecoder()
  private sseBuffer = ''
  private jsonBuffer = ''
  private contentType = ''
  private observedBytes = 0
  private usage: CapturedUsage = { promptTokens: 0, completionTokens: 0 }

  push(value: Uint8Array, contentType: string) {
    this.contentType = contentType
    const isEventStream = contentType.includes('text/event-stream')
    if (!isEventStream && this.observedBytes >= MAX_OBSERVED_RESPONSE_BYTES) return
    if (!isEventStream) this.observedBytes += value.byteLength
    const text = this.decoder.decode(value, { stream: true })
    if (isEventStream) {
      this.sseBuffer += text
      const lines = this.sseBuffer.split(/\r?\n/)
      this.sseBuffer = lines.pop() ?? ''
      for (const line of lines) this.observeSseLine(line)
    } else {
      this.jsonBuffer += text
    }
  }

  finish(): CapturedUsage {
    const tail = this.decoder.decode()
    if (this.contentType.includes('text/event-stream')) {
      this.sseBuffer += tail
      for (const line of this.sseBuffer.split(/\r?\n/)) this.observeSseLine(line)
      this.sseBuffer = ''
    } else {
      this.jsonBuffer += tail
      if (this.jsonBuffer) this.observeJson(this.jsonBuffer)
      this.jsonBuffer = ''
    }
    return { ...this.usage }
  }

  private observeSseLine(line: string) {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') return
    this.observeJson(data)
  }

  private observeJson(raw: string) {
    try {
      const payload = JSON.parse(raw) as Record<string, unknown>
      const next = extractUsage(payload)
      if (next.promptTokens || next.completionTokens) this.usage = { ...this.usage, ...next }
      const error = payload.error
      if (error && typeof error === 'object' && 'message' in error) {
        this.usage.error = String((error as { message?: unknown }).message ?? '').slice(0, 500)
      }
    } catch {
      // Partial or non-JSON upstream output is intentionally ignored.
    }
  }
}

export function extractUsage(payload: Record<string, unknown>): CapturedUsage {
  const usage = isRecord(payload.usage) ? payload.usage : undefined
  const timings = isRecord(payload.timings) ? payload.timings : undefined
  return {
    promptTokens: numberValue(usage?.prompt_tokens ?? usage?.input_tokens ?? timings?.prompt_n),
    completionTokens: numberValue(
      usage?.completion_tokens ?? usage?.output_tokens ?? timings?.predicted_n,
    ),
  }
}

export function describeEndpoint(method: string, pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const known: Record<string, string> = {
    '/v1/chat/completions': 'Chat completions',
    '/v1/completions': 'Completions',
    '/v1/responses': 'Responses',
    '/v1/embeddings': 'Embeddings',
    '/v1/rerank': 'Rerank',
    '/v1/models': 'Models',
    '/models': 'Models',
    '/slots': 'Slots',
    '/metrics': 'Metrics',
  }
  return known[normalized] ?? `${method.toUpperCase()} ${normalized}`
}

function makeStatus(
  state: ApiGatewayStatus['state'],
  host: string,
  port: number,
): ApiGatewayStatus {
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  const formattedHost = displayHost.includes(':') ? `[${displayHost}]` : displayHost
  return { state, host, port, url: `http://${formattedHost}:${port}` }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

function applyCors(response: ServerResponse) {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key, x-request-id')
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  requestId?: string,
) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  if (requestId) response.setHeader('x-request-id', requestId)
  response.end(JSON.stringify(value))
}

function bearerToken(value: string | undefined): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim()
}

function safeRequestId(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID()
}

function readClientIp(request: IncomingMessage): string | undefined {
  const forwarded = request.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return value?.trim().slice(0, 80) || request.socket.remoteAddress
}

async function readBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_REQUEST_BYTES) throw new Error('Request body exceeds the 32 MB gateway limit')
    chunks.push(buffer)
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

function readRequestMetadata(body: Uint8Array | undefined, contentType: string | undefined) {
  if (!body?.byteLength || !contentType?.includes('application/json')) {
    return { model: undefined, streaming: false }
  }
  try {
    const payload = JSON.parse(Buffer.from(body).toString('utf8')) as {
      model?: unknown
      stream?: unknown
    }
    return {
      model: typeof payload.model === 'string' ? payload.model.slice(0, 200) : undefined,
      streaming: payload.stream === true,
    }
  } catch {
    return { model: undefined, streaming: false }
  }
}

function upstreamHeaders(
  input: IncomingHttpHeaders,
  apiKey: string,
  requestId: string,
): Headers {
  const headers = new Headers()
  for (const [name, raw] of Object.entries(input)) {
    if (
      HOP_BY_HOP_HEADERS.has(name.toLowerCase()) ||
      name.toLowerCase() === 'authorization' ||
      name.toLowerCase() === 'x-api-key'
    ) continue
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, value)
    } else if (raw !== undefined) {
      headers.set(name, raw)
    }
  }
  if (apiKey) headers.set('authorization', `Bearer ${apiKey}`)
  headers.set('x-request-id', requestId)
  return headers
}

function copyResponseHeaders(headers: Headers, response: ServerResponse) {
  headers.forEach((value, name) => {
    if (
      HOP_BY_HOP_HEADERS.has(name.toLowerCase()) ||
      name.toLowerCase() === 'content-encoding'
    ) return
    response.setHeader(name, value)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return first?.trim() || undefined
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}
