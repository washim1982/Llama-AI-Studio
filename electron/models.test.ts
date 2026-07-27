import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanModelPaths } from './models'

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
