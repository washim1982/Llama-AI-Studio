import { describe, expect, it } from 'vitest'
import type { GgufModel } from '../src/types'
import { buildModelPreset } from './server'

const model = (overrides: Partial<GgufModel> = {}): GgufModel => ({
  id: 'abcdef123456',
  apiId: 'Qwen3-8B-Q4_K_M-abcdef1',
  path: 'C:\\Models\\Qwen3 8B Q4_K_M.gguf',
  name: 'Qwen3 8B',
  fileName: 'Qwen3 8B Q4_K_M.gguf',
  size: 5_000_000_000,
  architecture: 'qwen3',
  parameters: '8B',
  quantization: 'Q4_K_M',
  capabilities: {
    vision: true,
    embedding: false,
    reranker: false,
    reasoning: true,
    tools: true,
  },
  metadata: {},
  importedAt: 1,
  mmprojPath: 'C:\\Models\\mmproj-Qwen3-BF16.gguf',
  ...overrides,
})

describe('buildModelPreset', () => {
  it('registers models for router autoload without loading them on startup', () => {
    const preset = buildModelPreset([model()])

    expect(preset).toContain('[default]')
    expect(preset).toContain('[Qwen3-8B-Q4_K_M-abcdef1]')
    expect(preset).toContain('model = C:\\Models\\Qwen3 8B Q4_K_M.gguf')
    expect(preset).toContain('mmproj = C:\\Models\\mmproj-Qwen3-BF16.gguf')
    expect(preset).toContain('load-on-startup = false')
    expect(preset).toContain('stop-timeout = 10')
  })

  it('registers each available model plus a usable default alias', () => {
    const preset = buildModelPreset([
      model(),
      model({
        id: 'second',
        apiId: 'Llama-3-8B-Q5_K_M-1234567',
        path: 'D:\\Models\\Llama.gguf',
        mmprojPath: undefined,
      }),
    ])

    expect(preset.match(/model = /g)).toHaveLength(3)
    expect(preset).toContain('[Llama-3-8B-Q5_K_M-1234567]')
  })

  it('points default at the model selected when the router starts', () => {
    const second = model({
      id: 'second',
      apiId: 'Llama-3-8B-Q5_K_M-1234567',
      path: 'D:\\Models\\Llama.gguf',
      mmprojPath: undefined,
    })

    const preset = buildModelPreset([model(), second], second.id)
    const defaultSection = preset.split('[Llama-3-8B-Q5_K_M-1234567]')[0]

    expect(defaultSection).toContain('[default]')
    expect(defaultSection).toContain('model = D:\\Models\\Llama.gguf')
  })

  it('does not emit a duplicate section when a model already uses the default API ID', () => {
    const preset = buildModelPreset([model({ apiId: 'default' })])

    expect(preset.match(/\[default\]/g)).toHaveLength(1)
  })
})
