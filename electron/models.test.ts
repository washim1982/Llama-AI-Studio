import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GgufModel } from '../src/types'
import { pairVisionProjector, scanModelPaths } from './models'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('scanModelPaths', () => {
  it('reports incomplete and invalid GGUF files instead of hiding them', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'llama-forge-models-'))
    temporaryDirectories.push(directory)
    await writeFile(path.join(directory, 'model-Q4_K_M.gguf.partial'), Buffer.alloc(32))
    await writeFile(
      path.join(directory, 'broken-Q5_K_M.gguf'),
      Buffer.from('GGUF-not-valid-metadata'),
    )

    const models = await scanModelPaths([directory])

    expect(models).toHaveLength(2)
    expect(models.map((model) => model.validationState).sort()).toEqual([
      'incomplete',
      'invalid',
    ])
    expect(models.every((model) => Boolean(model.validationError))).toBe(true)
  })
})

describe('pairVisionProjector', () => {
  it('creates a persistent text and image-input model pair', () => {
    const textModel = makeModel({
      id: 'text',
      fileName: 'Qwen-VL-Q4_K_M.gguf',
      path: 'C:\\Models\\Qwen-VL-Q4_K_M.gguf',
    })
    const projector = makeModel({
      id: 'projector',
      fileName: 'mmproj-Qwen-VL-f16.gguf',
      path: 'C:\\Models\\mmproj-Qwen-VL-f16.gguf',
      size: 812_000_000,
      metadata: { 'general.type': 'mmproj' },
    })

    const paired = pairVisionProjector(textModel, projector)

    expect(paired.mmprojPath).toBe(projector.path)
    expect(paired.mmprojName).toBe(projector.fileName)
    expect(paired.mmprojSize).toBe(projector.size)
    expect(paired.capabilities.vision).toBe(true)
  })

  it('rejects a second language model in place of an mmproj projector', () => {
    expect(() => pairVisionProjector(makeModel(), makeModel({ id: 'other' }))).toThrow(
      'not an mmproj',
    )
  })
})

function makeModel(overrides: Partial<GgufModel> = {}): GgufModel {
  return {
    id: 'model',
    apiId: 'model-api',
    path: 'C:\\Models\\model.gguf',
    name: 'Model',
    fileName: 'model.gguf',
    size: 1_000_000,
    architecture: 'llama',
    parameters: '7B',
    quantization: 'Q4_K_M',
    capabilities: {
      vision: false,
      embedding: false,
      reranker: false,
      reasoning: false,
      tools: false,
    },
    metadata: {},
    importedAt: 1,
    validationState: 'valid',
    ...overrides,
  }
}
