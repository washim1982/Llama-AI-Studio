import type { RuntimeMemory, ServerStatus } from '../src/types'

const MIB = 1024 ** 2

const asBytes = (mib: string): number | undefined => {
  const value = Number(mib)
  return Number.isFinite(value) && value >= 0 ? value * MIB : undefined
}

const addDeviceBytes = (
  devices: RuntimeMemory['devices'],
  name: string,
  bytes: number,
): NonNullable<RuntimeMemory['devices']> => {
  const next = (devices ?? []).map((device) => ({ ...device }))
  const existing = next.find((device) => device.name === name)
  if (existing) existing.bytes += bytes
  else next.push({ name, bytes })
  return next
}

export function parseMemoryLine(
  rawLine: string,
  current: RuntimeMemory,
): RuntimeMemory {
  try {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, '').trim()
    const buffer = line.match(
      /^\S+:\s+(\S+)\s+(model|compute|KV) buffer size\s*=\s*([\d.]+)\s*MiB/i,
    )
    if (buffer) {
      const [, device, kind, rawMib] = buffer
      const bytes = asBytes(rawMib)
      if (bytes === undefined) return current
      const next: RuntimeMemory = { ...current }
      if (kind.toLowerCase() === 'model') next.modelBytes = (next.modelBytes ?? 0) + bytes
      else if (kind.toLowerCase() === 'compute') {
        next.computeBytes = (next.computeBytes ?? 0) + bytes
      } else {
        next.kvBytes = (next.kvBytes ?? 0) + bytes
      }
      if (device.toUpperCase().startsWith('CPU')) {
        next.hostBytes = (next.hostBytes ?? 0) + bytes
      } else {
        next.devices = addDeviceBytes(next.devices, device, bytes)
      }
      return next
    }

    const cache = line.match(
      /K \([^)]+\):\s*([\d.]+)\s*MiB,\s*V \([^)]+\):\s*([\d.]+)\s*MiB/i,
    )
    if (cache) {
      const kBytes = asBytes(cache[1])
      const vBytes = asBytes(cache[2])
      if (kBytes === undefined || vBytes === undefined) return current
      return { ...current, kvBytes: Math.max(current.kvBytes ?? 0, kBytes + vBytes) }
    }

    const context = line.match(/^llama_context:\s+n_ctx\s*=\s*(\d+)/i)
    if (context) {
      const contextTokens = Number(context[1])
      return Number.isSafeInteger(contextTokens)
        ? { ...current, contextTokens }
        : current
    }

    const offload = line.match(/offloaded\s+(\d+)\/(\d+)\s+layers to GPU/i)
    if (offload) return { ...current, offloadedLayers: `${offload[1]}/${offload[2]}` }
  } catch {
    // Runtime log parsing is observational
  }
  return current
}

export function parsePrometheus(text: string): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(
      /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{[^}]*\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/,
    )
    if (!match) continue
    const value = Number(match[2])
    if (!Number.isFinite(value)) continue
    metrics[match[1]] = (metrics[match[1]] ?? 0) + value
  }
  return metrics
}

export interface SlotUsage {
  activeRequests: number
  contextTokens?: number
  kvUsageRatio?: number
}

export function parseSlotUsage(payload: unknown): SlotUsage {
  if (!Array.isArray(payload)) return { activeRequests: 0 }
  let activeRequests = 0
  let usedTokens = 0
  let contextTokens = 0
  let hasUsage = false
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue
    const slot = entry as Record<string, unknown>
    if (slot.is_processing === true) activeRequests += 1
    const context = Number(slot.n_ctx)
    if (Number.isFinite(context) && context > 0) contextTokens += context
    const usedCandidates = [slot.n_tokens, slot.n_past, slot.tokens_cached]
    const used = usedCandidates
      .map(Number)
      .find((value) => Number.isFinite(value) && value >= 0)
    if (used !== undefined) {
      usedTokens += used
      hasUsage = true
    }
  }
  return {
    activeRequests,
    contextTokens: contextTokens || undefined,
    kvUsageRatio:
      hasUsage && contextTokens > 0
        ? Math.min(1, Math.max(0, usedTokens / contextTokens))
        : undefined,
  }
}

export function statusPollInterval(status: ServerStatus): number {
  if ((status.activeRequests ?? 0) > 0 || status.residency === 'loading') return 750
  if (status.residency === 'loaded') return 2_000
  return 5_000
}
