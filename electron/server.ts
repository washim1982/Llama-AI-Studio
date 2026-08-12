import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type {
  ChatChunk,
  ChatRequest,
  GgufModel,
  LoadConfig,
  RuntimeMemory,
  ServerStatus,
  ToolCall,
} from '../src/types'
import { attachmentDataUrl } from './attachments'
import { buildLlamaRouterArgs, buildLlamaServerArgs } from './llamaArgs'
import {
  parseMemoryLine,
  parsePrometheus,
  parseSlotUsage,
  statusPollInterval,
} from './memory'
import { describeRuntimeExecutionError } from './runtime'

const MAX_LOG_LINES = 3000
const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_LOG_LINE_BYTES = 64 * 1024

export class ServerManager {
  private child?: ChildProcessByStdio<null, Readable, Readable>
  private status: ServerStatus = {
    state: 'stopped',
    url: 'http://127.0.0.1:8080',
  }
  private readonly logs: string[] = []
  private readonly chatControllers = new Map<string, AbortController>()
  private apiKey = ''
  private activeRequestCount = 0
  private logBytes = 0
  private statusPoll?: ReturnType<typeof setTimeout>
  private pollInFlight = false
  private startPromise?: Promise<ServerStatus>
  private runtimeMemory: RuntimeMemory = {}
  private metricsEnabled = false
  private slotsEnabled = false

  constructor(
    private readonly getRuntimePath: () => string,
    private readonly getModels: () => GgufModel[],
    private readonly routerPresetPath: string,
    private readonly attachmentsDirectory: string,
    private readonly onStatus: (status: ServerStatus) => void,
    private readonly onLog: (line: string) => void,
    private readonly onChatChunk: (chunk: ChatChunk) => void,
  ) {}

  currentStatus(): ServerStatus {
    return { ...this.status }
  }

  getLogs(): string[] {
    return this.logs
  }

  gatewayTarget() {
    return {
      url: this.status.url,
      apiKey: this.apiKey,
      running: this.status.state === 'running',
    }
  }

  async start(model: GgufModel, config: LoadConfig): Promise<ServerStatus> {
    if (
      this.child &&
      this.status.state === 'running' &&
      ((config.onDemandLoading && this.status.mode === 'on-demand') ||
        (!config.onDemandLoading &&
          this.status.mode === 'pinned' &&
          this.status.modelId === model.id))
    ) {
      return this.currentStatus()
    }
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal(model, config)
    try {
      return await this.startPromise
    } finally {
      this.startPromise = undefined
    }
  }

  private async startInternal(model: GgufModel, config: LoadConfig): Promise<ServerStatus> {
    if (this.child) await this.stop()
    const executable = this.getRuntimePath()
    if (!executable) throw new Error('Select or install llama-server.exe first')
    const models = this.getModels().filter((item) => !item.validationError)
    if (config.onDemandLoading && !models.length) {
      throw new Error('Import at least one inference GGUF model before starting demand loading')
    }
    let args: string[]
    if (config.onDemandLoading) {
      await mkdir(path.dirname(this.routerPresetPath), { recursive: true })
      await writeFile(this.routerPresetPath, buildModelPreset(models, model.id), 'utf8')
      args = buildLlamaRouterArgs(this.routerPresetPath, config)
    } else {
      args = buildLlamaServerArgs(model.path, {
        ...config,
        alias: config.alias || model.apiId,
        mmprojPath: model.mmprojPath || config.mmprojPath || '',
      })
    }
    const url = `http://${normalizeHost(config.host)}:${config.port}`
    const displayArgs = redactSensitiveArguments(args)
    this.apiKey = config.apiKey
    this.runtimeMemory = {}
    this.metricsEnabled = config.metrics
    this.slotsEnabled = config.slots
    this.setStatus({
      state: 'starting',
      url,
      mode: config.onDemandLoading ? 'on-demand' : 'pinned',
      residency: config.onDemandLoading ? 'unloaded' : 'loading',
      activeRequests: 0,
      managedModels: config.onDemandLoading ? models.length : 1,
      modelId: config.onDemandLoading ? undefined : model.id,
      modelApiId: config.onDemandLoading ? undefined : model.apiId,
      modelName: config.onDemandLoading ? undefined : model.name,
      command: formatCommand(executable, displayArgs),
      memory: undefined,
      kvUsageRatio: undefined,
      promptCacheBytes: config.cacheRam > 0 ? config.cacheRam * 1024 ** 2 : undefined,
    })
    this.pushLog(`$ ${formatCommand(executable, displayArgs)}`)

    const child = spawn(executable, args, {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getEnvWithRuntimePath(executable),
    })
    this.child = child
    this.setStatus({ ...this.status, pid: child.pid })
    this.attachOutput(child.stdout)
    this.attachOutput(child.stderr)
    child.once('error', (error) => {
      this.pushLog(`[process error] ${error.message}`)
      this.setStatus({ ...this.status, state: 'error', error: error.message })
      this.child = undefined
    })
    child.once('exit', (code, signal) => {
      this.stopStatusPolling()
      this.pushLog(`[server exited] code=${code ?? 'null'} signal=${signal ?? 'none'}`)
      this.child = undefined
      if (this.status.state !== 'stopping') {
        const lastLog = this.logs
          .slice(-15)
          .map((l) => l.replace(/^.*?\t\s*/, '').replace(/^[0-9:\sAPMapm]{8,15}\s*/, '').trim())
          .filter((l) => l && !l.startsWith('$ ') && !l.includes('[server exited]'))
          .pop()
        const baseError = describeRuntimeExecutionError({ code: code ?? 'unknown', signal })
        const error = code === 0 ? undefined : lastLog ? `${baseError}: ${lastLog}` : baseError
        this.setStatus({
          ...this.status,
          state: code === 0 ? 'stopped' : 'error',
          error,
          pid: undefined,
        })
      }
    })

    const healthy = await this.waitForHealth(url, child)
    if (!healthy) {
      if (this.status.state === 'error') throw new Error(this.status.error)
      await this.stop()
      throw new Error('llama-server did not become ready within 90 seconds')
    }
    this.setStatus({
      ...this.status,
      state: 'running',
      residency: config.onDemandLoading ? 'unloaded' : 'loaded',
      startedAt: Date.now(),
      error: undefined,
    })
    this.startStatusPolling()
    return this.currentStatus()
  }

  async stop(): Promise<ServerStatus> {
    this.stopStatusPolling()
    const child = this.child
    if (!child) {
      this.runtimeMemory = {}
      this.setStatus({ state: 'stopped', url: this.status.url })
      return this.currentStatus()
    }
    this.setStatus({ ...this.status, state: 'stopping' })
    for (const controller of this.chatControllers.values()) controller.abort()
    this.chatControllers.clear()
    this.activeRequestCount = 0

    await new Promise<void>((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        resolve()
      }
      child.once('exit', finish)
      child.kill()
      setTimeout(() => {
        if (child.exitCode === null && child.pid && process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            windowsHide: true,
            stdio: 'ignore',
          })
          killer.once('exit', finish)
          killer.once('error', finish)
        } else {
          finish()
        }
      }, 3000)
      setTimeout(finish, 8000)
    })
    this.child = undefined
    this.runtimeMemory = {}
    this.setStatus({ state: 'stopped', url: this.status.url })
    return this.currentStatus()
  }

  async releaseMemory(): Promise<ServerStatus> {
    if (this.status.state !== 'running') return this.currentStatus()
    if (this.status.mode !== 'on-demand') return this.stop()
    const model = this.status.modelApiId
    if (!model || this.status.residency === 'unloaded') return this.currentStatus()
    const response = await fetch(`${this.status.url}/models/unload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        this.pushLog(
          '[memory release] router unload is unavailable; stopping the API to release memory',
        )
        return this.stop()
      }
      throw new Error(`llama-server returned ${response.status}: ${await response.text()}`)
    }
    this.runtimeMemory = {}
    this.setStatus({
      ...this.status,
      residency: 'unloaded',
      modelId: undefined,
      modelApiId: undefined,
      modelName: undefined,
      memory: undefined,
      kvUsageRatio: undefined,
    })
    return this.currentStatus()
  }

  async chat(request: ChatRequest): Promise<void> {
    if (this.status.state !== 'running') throw new Error('Load a model before chatting')
    const controller = new AbortController()
    this.chatControllers.set(request.requestId, controller)
    this.activeRequestCount += 1
    const requestedModel = this.getModels().find((model) => model.apiId === request.model)
    if (
      this.status.mode === 'on-demand' &&
      (this.status.modelApiId !== request.model || this.status.residency === 'unloaded')
    ) {
      this.runtimeMemory = {}
    }
    this.setStatus({
      ...this.status,
      activeRequests: this.activeRequestCount,
      ...(this.status.mode === 'on-demand'
        ? {
            residency: 'loading',
            modelId: requestedModel?.id,
            modelApiId: requestedModel?.apiId ?? request.model,
            modelName: requestedModel?.name ?? request.model,
            memory: Object.keys(this.runtimeMemory).length ? this.runtimeMemory : undefined,
            kvUsageRatio: undefined,
          }
        : {}),
    })
    try {
      const messages = []
      if (request.systemPrompt.trim()) {
        messages.push({ role: 'system', content: request.systemPrompt.trim() })
      }
      for (const message of request.messages.filter((item) => item.role !== 'system')) {
        if (message.attachments?.length && message.role === 'user') {
          const imageUrls = await Promise.all(
            message.attachments.map((attachment) =>
              attachmentDataUrl(attachment, this.attachmentsDirectory),
            ),
          )
          messages.push({
            role: message.role,
            content: [
              { type: 'text', text: message.content },
              ...imageUrls.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            ],
          });
        } else {
          messages.push({ role: message.role, content: message.content })
        }
      }

      const sampling = request.sampling
      const body: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: true,
        temperature: sampling.temperature,
        top_k: sampling.topK,
        top_p: sampling.topP,
        min_p: sampling.minP,
        typical_p: sampling.typicalP,
        top_n_sigma: sampling.topNSigma,
        xtc_probability: sampling.xtcProbability,
        xtc_threshold: sampling.xtcThreshold,
        repeat_last_n: sampling.repeatLastN,
        repeat_penalty: sampling.repeatPenalty,
        presence_penalty: sampling.presencePenalty,
        frequency_penalty: sampling.frequencyPenalty,
        dry_multiplier: sampling.dryMultiplier,
        dry_base: sampling.dryBase,
        dry_allowed_length: sampling.dryAllowedLength,
        dry_penalty_last_n: sampling.dryPenaltyLastN,
        adaptive_target: sampling.adaptiveTarget,
        adaptive_decay: sampling.adaptiveDecay,
        dynatemp_range: sampling.dynamicTemperatureRange,
        dynatemp_exponent: sampling.dynamicTemperatureExponent,
        mirostat: sampling.mirostat,
        mirostat_tau: sampling.mirostatTau,
        mirostat_eta: sampling.mirostatEta,
        seed: sampling.seed,
        max_tokens: sampling.maxTokens,
        stop: sampling.stop,
        ignore_eos: sampling.ignoreEos,
        samplers: sampling.samplerOrder.split(';').filter(Boolean),
        stream_options: { include_usage: true },
      }
      if (sampling.reasoningEffort === 'none') body.reasoning_effort = 'none'
      if (sampling.grammar.trim()) body.grammar = sampling.grammar
      if (sampling.jsonSchema.trim()) {
        try {
          body.response_format = {
            type: 'json_schema',
            schema: JSON.parse(sampling.jsonSchema),
          }
        } catch {
          throw new Error('Structured output JSON Schema is not valid JSON')
        }
      }

      const response = await fetch(`${this.status.url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        const details = await response.text()
        throw new Error(`llama-server returned ${response.status}: ${details}`)
      }
      await this.consumeSse(request.requestId, response.body)
      this.onChatChunk({ requestId: request.requestId, done: true })
    } catch (error) {
      if (controller.signal.aborted) {
        this.onChatChunk({ requestId: request.requestId, done: true })
      } else {
        this.onChatChunk({
          requestId: request.requestId,
          error: error instanceof Error ? error.message : String(error),
          done: true,
        })
      }
    } finally {
      this.chatControllers.delete(request.requestId)
      this.activeRequestCount = Math.max(0, this.activeRequestCount - 1)
      this.setStatus({ ...this.status, activeRequests: this.activeRequestCount })
      if (this.status.mode === 'on-demand') {
        setTimeout(() => void this.refreshStatus(), 100)
      }
    }
  }

  cancelChat(requestId: string) {
    this.chatControllers.get(requestId)?.abort()
  }

  private async consumeSse(requestId: string, body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data || data === '[DONE]') continue
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string
                reasoning_content?: string
                reasoning?: string
                tool_calls?: Array<{
                  id?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
            }>
            usage?: { prompt_tokens?: number; completion_tokens?: number }
          }
          try {
            parsed = JSON.parse(data)
          } catch {
            continue
          }
          const delta = parsed.choices?.[0]?.delta
          const toolCalls: ToolCall[] | undefined = delta?.tool_calls?.map((call, index) => ({
            id: call.id ?? `${requestId}-${index}`,
            name: call.function?.name ?? '',
            arguments: call.function?.arguments ?? '',
          }))
          this.onChatChunk({
            requestId,
            content: delta?.content,
            reasoning: delta?.reasoning_content ?? delta?.reasoning,
            toolCalls,
            promptTokens: parsed.usage?.prompt_tokens,
            completionTokens: parsed.usage?.completion_tokens,
          })
        }
      }
    }
  }

  private attachOutput(stream: NodeJS.ReadableStream) {
    let buffer = ''
    stream.on('error', (error) => {
      this.pushLog(
        `[process output error] ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString()
      while (Buffer.byteLength(buffer, 'utf8') > MAX_LOG_LINE_BYTES) {
        const [segment, remainder] = takeUtf8Prefix(buffer, MAX_LOG_LINE_BYTES)
        buffer = remainder
        this.observeRuntimeLine(`${segment} [line truncated]`)
      }
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) this.observeRuntimeLine(line)
    })
    stream.on('end', () => {
      if (buffer.trim()) this.observeRuntimeLine(buffer)
    })
  }

  private observeRuntimeLine(line: string) {
    const nextMemory = parseMemoryLine(line, this.runtimeMemory)
    if (nextMemory !== this.runtimeMemory) {
      this.runtimeMemory = nextMemory
      this.setStatus({ ...this.status, memory: { ...nextMemory } })
    }
    this.pushLog(line)
  }

  private pushLog(line: string) {
    const clean = stripAnsi(line)
    const stamped = `${new Date().toLocaleTimeString()}  ${clean}`
    this.logs.push(stamped)
    this.logBytes += Buffer.byteLength(stamped, 'utf8')
    while (this.logs.length > MAX_LOG_LINES || this.logBytes > MAX_LOG_BYTES) {
      const removed = this.logs.shift()
      if (!removed) break
      this.logBytes = Math.max(0, this.logBytes - Buffer.byteLength(removed, 'utf8'))
    }
    this.onLog(stamped)
  }

  private setStatus(status: ServerStatus) {
    this.status = status
    this.onStatus(this.currentStatus())
  }

  private startStatusPolling() {
    this.stopStatusPolling()
    void this.refreshStatus()
  }

  private stopStatusPolling() {
    if (this.statusPoll) clearTimeout(this.statusPoll)
    this.statusPoll = undefined
  }

  private scheduleStatusPoll() {
    if (this.status.state !== 'running') return
    this.statusPoll = setTimeout(
      () => void this.refreshStatus(),
      statusPollInterval(this.status),
    )
    this.statusPoll.unref?.()
  }

  private async refreshStatus() {
    if (this.status.state !== 'running' || this.pollInFlight) return
    this.pollInFlight = true
    this.stopStatusPolling()
    try {
      if (this.status.mode === 'on-demand') await this.refreshRouterModelStatus()
      const modelQuery = this.status.modelApiId
        ? `?model=${encodeURIComponent(this.status.modelApiId)}`
        : ''
      if (this.metricsEnabled) {
        const response = await this.authorizedFetch(`/metrics${modelQuery}`)
        if (response.ok) {
          const metrics = parsePrometheus(await response.text())
          const metricActive =
            (metrics['llamacpp:requests_processing'] ?? 0) +
            (metrics['llamacpp:requests_deferred'] ?? 0)
          const usedTokens = metrics['llamacpp:kv_cache_tokens']
          const maximumTokens =
            metrics['llamacpp:n_tokens_max'] ?? this.runtimeMemory.contextTokens
          const ratio = metrics['llamacpp:kv_cache_usage_ratio']
          this.updateObservedStatus({
            activeRequests: Math.max(this.activeRequestCount, metricActive),
            kvUsageRatio:
              ratio !== undefined
                ? clampRatio(ratio)
                : usedTokens !== undefined && maximumTokens
                  ? clampRatio(usedTokens / maximumTokens)
                  : this.status.kvUsageRatio,
          })
        }
      }
      if (this.slotsEnabled) {
        const response = await this.authorizedFetch(`/slots${modelQuery}`)
        if (response.ok) {
          const slots = parseSlotUsage(await response.json())
          if (slots.contextTokens && !this.runtimeMemory.contextTokens) {
            this.runtimeMemory = {
              ...this.runtimeMemory,
              contextTokens: slots.contextTokens,
            }
          }
          this.updateObservedStatus({
            memory: Object.keys(this.runtimeMemory).length
              ? { ...this.runtimeMemory }
              : undefined,
            activeRequests: Math.max(this.activeRequestCount, slots.activeRequests),
            kvUsageRatio: slots.kvUsageRatio ?? this.status.kvUsageRatio,
          });
        }
      }
    } catch {
      // Runtime observation is best-effort
    } finally {
      this.pollInFlight = false
      this.scheduleStatusPoll()
    }
  }

  private async refreshRouterModelStatus() {
    const response = await this.authorizedFetch('/models')
    if (!response.ok) return
    const payload = (await response.json()) as {
      data?: Array<{
        id?: string
        status?: { value?: 'unloaded' | 'loading' | 'loaded' | 'sleeping' }
      }>
    }
    const candidates = payload.data ?? []
    const active =
      candidates.find((entry) => entry.status?.value === 'loading') ??
      candidates.find((entry) => entry.status?.value === 'loaded') ??
      candidates.find((entry) => entry.status?.value === 'sleeping')
    const residency = active?.status?.value ?? 'unloaded'
    const model = this.getModels().find((item) => item.apiId === active?.id)
    if (active?.id !== this.status.modelApiId && this.activeRequestCount === 0) {
      this.runtimeMemory = {}
    }
    this.updateObservedStatus({
      residency,
      modelId: model?.id,
      modelApiId: active?.id,
      modelName: model?.name ?? active?.id,
      managedModels: candidates.length || this.getModels().length,
      activeRequests: this.activeRequestCount,
      memory: Object.keys(this.runtimeMemory).length ? this.runtimeMemory : undefined,
      kvUsageRatio: active ? this.status.kvUsageRatio : undefined,
    })
  }

  private async authorizedFetch(resource: string) {
    return fetch(`${this.status.url}${resource}`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      signal: AbortSignal.timeout(1200),
    })
  }

  private updateObservedStatus(patch: Partial<ServerStatus>) {
    const next = { ...this.status, ...patch }
    if (JSON.stringify(next) !== JSON.stringify(this.status)) this.setStatus(next)
  }

  private async waitForHealth(
    baseUrl: string,
    child: ChildProcessByStdio<null, Readable, Readable>,
  ): Promise<boolean> {
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const response = await fetch(`${baseUrl}/health`, {
          headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
          signal: AbortSignal.timeout(1000),
        })
        if (response.ok) return true
      } catch {
        // Wait
      }
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    return false
  }
}

export function buildModelPreset(models: GgufModel[], defaultModelId?: string): string {
  const lines = ['version = 1', '']
  const defaultModel =
    models.find((model) => model.id === defaultModelId) ?? models[0]
  const presets = [
    ...(defaultModel ? [{ section: 'default', model: defaultModel }] : []),
    ...models
      .filter((model) => model.apiId.toLowerCase() !== 'default')
      .map((model) => ({ section: model.apiId, model })),
  ]
  for (const { section, model } of presets) {
    lines.push(`[${sanitizeIniSection(section)}]`)
    lines.push(`model = ${sanitizeIniValue(model.path)}`)
    if (model.mmprojPath) lines.push(`mmproj = ${sanitizeIniValue(model.mmprojPath)}`)
    lines.push('load-on-startup = false')
    lines.push('stop-timeout = 10')
    lines.push('')
  }
  return lines.join('\n')
}

function sanitizeIniSection(value: string): string {
  return value.replace(/[\]\r\n]/g, '-')
}

function sanitizeIniValue(value: string): string {
  return value.replace(/[\r\n]/g, ' ')
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

function normalizeHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function takeUtf8Prefix(value: string, maximumBytes: number): [string, string] {
  let low = 0
  let high = Math.min(value.length, maximumBytes)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maximumBytes) low = middle
    else high = middle - 1
  }
  const index = Math.max(1, low)
  return [value.slice(0, index), value.slice(index)]
}

function quoteArgument(value: string): string {
  if (!/[\s"]/g.test(value)) return value
  return `"${value.replaceAll('"', '\\"')}"`
}

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteArgument).join(' ')
}

export function redactSensitiveArguments(args: string[]): string[] {
  let redactNext = false
  return args.map((argument) => {
    if (redactNext) {
      redactNext = false
      return '[redacted]'
    }
    if (argument === '--api-key') {
      redactNext = true
      return argument
    }
    if (argument.startsWith('--api-key=')) return '--api-key=[redacted]'
    return argument
  })
}

function getEnvWithRuntimePath(executable: string): Record<string, string | undefined> {
  const runtimeDir = path.dirname(executable)
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
  const currentPath = env[pathKey] || ''
  env[pathKey] = currentPath ? `${runtimeDir}${path.delimiter}${currentPath}` : runtimeDir
  return env
}
