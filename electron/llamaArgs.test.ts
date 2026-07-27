import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LLAMA_SERVER_PORT,
  defaultLoadConfig,
  migrateServerPort,
} from './defaults'
import {
  buildLlamaRouterArgs,
  buildLlamaServerArgs,
  tokenizeArguments,
} from './llamaArgs'

describe('tokenizeArguments', () => {
  it('keeps quoted values together without invoking a shell', () => {
    expect(tokenizeArguments('--prio 2 --chat-template-kwargs \'{"thinking": false}\'')).toEqual([
      '--prio',
      '2',
      '--chat-template-kwargs',
      '{"thinking": false}',
    ])
  })

  it('rejects an unclosed quote', () => {
    expect(() => tokenizeArguments('--alias "unfinished')).toThrow(/Unclosed quote/)
  })
})

describe('buildLlamaServerArgs', () => {
  it('uses the llama.cpp default port and migrates the old LM Studio port', () => {
    expect(defaultLoadConfig.port).toBe(DEFAULT_LLAMA_SERVER_PORT)
    expect(migrateServerPort(1234)).toBe(8080)
    expect(migrateServerPort(9000)).toBe(9000)
  })

  it('maps structured GPU, cache, reasoning, API, and multimodal options', () => {
    const args = buildLlamaServerArgs('C:\\Models\\model.gguf', {
      ...defaultLoadConfig,
      gpuLayers: 'all',
      contextSize: 32768,
      cacheTypeK: 'q8_0',
      cacheTypeV: 'q4_0',
      mmprojPath: 'C:\\Models\\mmproj.gguf',
      reasoning: 'on',
      apiKey: 'secret',
      speculativeType: 'draft-simple',
      draftModelPath: 'C:\\Models\\draft.gguf',
      tools: ['read_file', 'grep_search'],
    })

    expect(args).toContain('--model')
    expect(args).toContain('C:\\Models\\model.gguf')
    expect(args).toContain('--n-gpu-layers')
    expect(args).toContain('all')
    expect(args).toContain('--ctx-size')
    expect(args).toContain('32768')
    expect(args).toContain('--mmproj')
    expect(args).toContain('--spec-draft-model')
    expect(args).toContain('--tools')
    expect(args).toContain('read_file,grep_search')
    expect(args.at(-1)).toBe('--no-ui')
  })

  it('starts a demand-loading router with one resident model and custom idle sleep', () => {
    const args = buildLlamaRouterArgs('C:\\Data\\models.ini', {
      ...defaultLoadConfig,
      onDemandLoading: true,
      maxLoadedModels: 1,
      sleepIdleSeconds: 300,
    })

    expect(args).toContain('--models-preset')
    expect(args).toContain('C:\\Data\\models.ini')
    expect(args).toContain('--models-max')
    expect(args).toContain('1')
    expect(args).toContain('--models-autoload')
    expect(args).toContain('--sleep-idle-seconds')
    expect(args).toContain('300')
    expect(args).not.toContain('--model')

    const defaultArgs = buildLlamaRouterArgs('C:\\Data\\models.ini', defaultLoadConfig)
    expect(defaultArgs).not.toContain('--sleep-idle-seconds')
  })
})
