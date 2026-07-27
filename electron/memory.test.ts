import { describe, expect, it } from 'vitest'
import type { RuntimeMemory } from '../src/types'
import {
  parseMemoryLine,
  parsePrometheus,
  parseSlotUsage,
  statusPollInterval,
} from './memory'

describe('parseMemoryLine', () => {
  it('aggregates CUDA, Vulkan, CPU and KV allocations', () => {
    const lines = [
      'llama_model_load: CUDA0 model buffer size = 4096.00 MiB',
      'llama_context: Vulkan0 compute buffer size = 256.50 MiB',
      'llama_kv_cache: CPU KV buffer size = 128.00 MiB',
      'llama_kv_cache: K (f16): 64.00 MiB, V (f16): 64.00 MiB',
      'llama_context: n_ctx = 8192',
      'llama_model_loader: offloaded 33/33 layers to GPU',
    ]
    const memory = lines.reduce<RuntimeMemory>(
      (current, line) => parseMemoryLine(line, current),
      {},
    )

    expect(memory.modelBytes).toBe(4096 * 1024 ** 2)
    expect(memory.computeBytes).toBe(256.5 * 1024 ** 2)
    expect(memory.kvBytes).toBe(128 * 1024 ** 2)
    expect(memory.hostBytes).toBe(128 * 1024 ** 2)
    expect(memory.devices).toEqual([
      { name: 'CUDA0', bytes: 4096 * 1024 ** 2 },
      { name: 'Vulkan0', bytes: 256.5 * 1024 ** 2 },
    ])
    expect(memory.contextTokens).toBe(8192)
    expect(memory.offloadedLayers).toBe('33/33')
  })

  it('ignores malformed or truncated lines without throwing', () => {
    const current = { modelBytes: 42 }
    expect(parseMemoryLine('llama_context: n_ctx = nope', current)).toBe(current)
    expect(parseMemoryLine('CUDA0 model buffer size =', current)).toBe(current)
  })
})

describe('live observation parsers', () => {
  it('reduces Prometheus gauges, including labelled samples', () => {
    expect(
      parsePrometheus(`
# HELP llamacpp:requests_processing Active requests
llamacpp:requests_processing{model="one"} 1
llamacpp:requests_processing{model="two"} 2
llamacpp:kv_cache_usage_ratio 0.875
`),
    ).toMatchObject({
      'llamacpp:requests_processing': 3,
      'llamacpp:kv_cache_usage_ratio': 0.875,
    })
  })

  it('only reports slot pressure when token occupancy is exposed', () => {
    expect(
      parseSlotUsage([
        { is_processing: true, n_ctx: 4096, n_past: 2048 },
        { is_processing: false, n_ctx: 4096 },
      ]),
    ).toEqual({ activeRequests: 1, contextTokens: 8192, kvUsageRatio: 0.25 })
    expect(parseSlotUsage([{ is_processing: false, n_ctx: 4096 }]).kvUsageRatio).toBeUndefined()
  })

  it('backs off status polling when the runtime is idle', () => {
    expect(statusPollInterval({ state: 'running', url: '', activeRequests: 1 })).toBe(750)
    expect(statusPollInterval({ state: 'running', url: '', residency: 'loaded' })).toBe(2000)
    expect(statusPollInterval({ state: 'running', url: '', residency: 'unloaded' })).toBe(5000)
  })
})
