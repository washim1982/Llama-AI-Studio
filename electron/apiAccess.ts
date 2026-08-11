import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type {
  AdminDashboardSnapshot,
  ApiGatewaySettings,
  ApiGatewayStatus,
  ApiKeyRecord,
  ApiKeyUsage,
  ApiTrace,
  ApiUsageBucket,
  ApiUsageSummary,
  CreateApiKeyInput,
  GeneratedApiKey,
} from '../src/types'

const MAX_RECENT_TRACES = 5_000
const MAX_USER_NAME_LENGTH = 120

interface StoredApiKey extends ApiKeyRecord {
  keyHash: string
}

interface UsageAggregate {
  requests: number
  errors: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  latencyMs: number
  lastRequestAt?: number
}

interface PersistedAccessData {
  version: 1
  keys: StoredApiKey[]
  total: UsageAggregate
  byKey: Record<string, UsageAggregate>
}

type TraceWithoutCost = Omit<ApiTrace, 'cost'> & { cost?: number }

export class ApiAccessStore {
  private readonly statePath: string
  private readonly tracePath: string
  private state: PersistedAccessData = emptyState()
  private traces: ApiTrace[] = []
  private persistenceQueue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {
    this.statePath = path.join(directory, 'access.json')
    this.tracePath = path.join(directory, 'traces.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as PersistedAccessData
      this.state = normalizeState(parsed)
    } catch {
      this.state = emptyState()
    }
    try {
      const parsed = JSON.parse(await readFile(this.tracePath, 'utf8')) as ApiTrace[]
      this.traces = Array.isArray(parsed) ? parsed.slice(-MAX_RECENT_TRACES) : []
    } catch {
      this.traces = []
    }
  }

  createKey(input: CreateApiKeyInput, defaults: ApiGatewaySettings): GeneratedApiKey {
    const userName = input.userName.trim()
    if (!userName) throw new Error('Enter a user or service name')
    if (userName.length > MAX_USER_NAME_LENGTH) {
      throw new Error(`User name must be ${MAX_USER_NAME_LENGTH} characters or fewer`)
    }
    const inputRate = validRate(input.inputCostPerMillion, defaults.defaultInputCostPerMillion)
    const outputRate = validRate(input.outputCostPerMillion, defaults.defaultOutputCostPerMillion)
    const secret = `llama_live_${randomBytes(32).toString('base64url')}`
    const key: StoredApiKey = {
      id: randomUUID(),
      userName,
      prefix: `${secret.slice(0, 20)}…`,
      keyHash: hashApiKey(secret),
      createdAt: Date.now(),
      inputCostPerMillion: inputRate,
      outputCostPerMillion: outputRate,
    }
    this.state.keys.unshift(key)
    this.queuePersist()
    return { key: publicKey(key), secret }
  }

  revokeKey(id: string): ApiKeyRecord {
    const key = this.state.keys.find((candidate) => candidate.id === id)
    if (!key) throw new Error('API key not found')
    if (!key.revokedAt) key.revokedAt = Date.now()
    this.queuePersist()
    return publicKey(key)
  }

  authenticate(secret: string): ApiKeyRecord | undefined {
    if (!secret) return undefined
    const digest = hashApiKey(secret)
    const key = this.state.keys.find(
      (candidate) => candidate.keyHash === digest && !candidate.revokedAt,
    )
    return key ? publicKey(key) : undefined
  }

  recordTrace(input: TraceWithoutCost): ApiTrace {
    const key = input.apiKeyId
      ? this.state.keys.find((candidate) => candidate.id === input.apiKeyId)
      : undefined
    const cost =
      input.cost ??
      (key
        ? (input.promptTokens * key.inputCostPerMillion +
            input.completionTokens * key.outputCostPerMillion) /
          1_000_000
        : 0)
    const trace: ApiTrace = { ...input, cost }
    this.traces.push(trace)
    if (this.traces.length > MAX_RECENT_TRACES) this.traces.shift()

    addToAggregate(this.state.total, trace)
    if (key) {
      key.lastUsedAt = trace.startedAt + trace.durationMs
      const aggregate = (this.state.byKey[key.id] ??= emptyAggregate())
      addToAggregate(aggregate, trace)
    }
    this.queuePersist()
    return trace
  }

  dashboard(gateway: ApiGatewayStatus): AdminDashboardSnapshot {
    const latencies = this.traces.map((trace) => trace.durationMs)
    const summary = publicAggregate(this.state.total, percentile(latencies, 0.95))
    const keys: ApiKeyUsage[] = this.state.keys.map((key) => {
      const aggregate = this.state.byKey[key.id] ?? emptyAggregate()
      const keyLatencies = this.traces
        .filter((trace) => trace.apiKeyId === key.id)
        .map((trace) => trace.durationMs)
      return {
        key: publicKey(key),
        ...publicAggregate(aggregate, percentile(keyLatencies, 0.95)),
        lastRequestAt: aggregate.lastRequestAt,
      }
    })
    const endpoints = [...new Set(this.traces.map((trace) => trace.endpoint))].sort()
    return {
      gateway,
      summary,
      activeKeys: this.state.keys.filter((key) => !key.revokedAt).length,
      keys,
      traffic: makeTrafficBuckets(this.traces),
      traces: [...this.traces].reverse().slice(0, 250),
      endpoints,
      generatedAt: Date.now(),
    }
  }

  async flush(): Promise<void> {
    await this.persistenceQueue
  }

  private queuePersist() {
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(async () => {
        await writeFileAtomic(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
        await writeFileAtomic(this.tracePath, JSON.stringify(this.traces), 'utf8')
      })
  }
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function emptyState(): PersistedAccessData {
  return { version: 1, keys: [], total: emptyAggregate(), byKey: {} }
}

function normalizeState(value: PersistedAccessData): PersistedAccessData {
  if (!value || value.version !== 1 || !Array.isArray(value.keys)) return emptyState()
  return {
    version: 1,
    keys: value.keys,
    total: { ...emptyAggregate(), ...value.total },
    byKey: Object.fromEntries(
      Object.entries(value.byKey ?? {}).map(([id, aggregate]) => [
        id,
        { ...emptyAggregate(), ...aggregate },
      ]),
    ),
  }
}

function emptyAggregate(): UsageAggregate {
  return {
    requests: 0,
    errors: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    latencyMs: 0,
  }
}

function addToAggregate(aggregate: UsageAggregate, trace: ApiTrace) {
  aggregate.requests += 1
  aggregate.errors += trace.status >= 400 ? 1 : 0
  aggregate.promptTokens += trace.promptTokens
  aggregate.completionTokens += trace.completionTokens
  aggregate.totalTokens += trace.totalTokens
  aggregate.cost += trace.cost
  aggregate.latencyMs += trace.durationMs
  aggregate.lastRequestAt = trace.startedAt + trace.durationMs
}

function publicAggregate(aggregate: UsageAggregate, p95LatencyMs: number): ApiUsageSummary {
  return {
    requests: aggregate.requests,
    errors: aggregate.errors,
    promptTokens: aggregate.promptTokens,
    completionTokens: aggregate.completionTokens,
    totalTokens: aggregate.totalTokens,
    cost: aggregate.cost,
    p95LatencyMs,
  }
}

function publicKey(key: StoredApiKey): ApiKeyRecord {
  const { keyHash: _keyHash, ...visible } = key
  return { ...visible }
}

function validRate(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback
  if (!Number.isFinite(candidate) || candidate < 0) {
    throw new Error('Token prices must be positive numbers or zero')
  }
  return candidate
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0
}

function makeTrafficBuckets(traces: ApiTrace[]): ApiUsageBucket[] {
  const hour = 60 * 60 * 1_000
  const finalBucket = Math.floor(Date.now() / hour) * hour
  const buckets = new Map<number, ApiUsageBucket>()
  for (let index = 23; index >= 0; index -= 1) {
    const startedAt = finalBucket - index * hour
    buckets.set(startedAt, { startedAt, requests: 0, errors: 0, tokens: 0, cost: 0 })
  }
  for (const trace of traces) {
    const startedAt = Math.floor(trace.startedAt / hour) * hour
    const bucket = buckets.get(startedAt)
    if (!bucket) continue
    bucket.requests += 1
    bucket.errors += trace.status >= 400 ? 1 : 0
    bucket.tokens += trace.totalTokens
    bucket.cost += trace.cost
  }
  return [...buckets.values()]
}
