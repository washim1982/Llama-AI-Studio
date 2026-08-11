import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiGatewaySettings, ApiGatewayStatus } from '../src/types'
import { ApiAccessStore } from './apiAccess'

const directories: string[] = []
const settings: ApiGatewaySettings = {
  enabled: true,
  host: '127.0.0.1',
  port: 8181,
  defaultInputCostPerMillion: 2,
  defaultOutputCostPerMillion: 8,
}
const gateway: ApiGatewayStatus = {
  state: 'running',
  host: '127.0.0.1',
  port: 8181,
  url: 'http://127.0.0.1:8181',
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ApiAccessStore', () => {
  it('persists only a key digest and rejects revoked credentials', async () => {
    const directory = await makeDirectory()
    const store = new ApiAccessStore(directory)
    await store.initialize()

    const generated = store.createKey({ userName: 'Batch processor' }, settings)
    expect(store.authenticate(generated.secret)?.userName).toBe('Batch processor')
    expect(store.authenticate('llama_live_not-the-key')).toBeUndefined()
    await store.flush()

    const persisted = await readFile(path.join(directory, 'access.json'), 'utf8')
    expect(persisted).not.toContain(generated.secret)
    expect(persisted).toContain('keyHash')

    store.revokeKey(generated.key.id)
    expect(store.authenticate(generated.secret)).toBeUndefined()
    await store.flush()
  })

  it('attributes token cost and errors to the correct API key', async () => {
    const directory = await makeDirectory()
    const store = new ApiAccessStore(directory)
    await store.initialize()
    const generated = store.createKey(
      { userName: 'Product', inputCostPerMillion: 1, outputCostPerMillion: 4 },
      settings,
    )
    store.recordTrace({
      id: 'trace-1',
      requestId: 'request-1',
      apiKeyId: generated.key.id,
      apiKeyName: generated.key.userName,
      method: 'POST',
      path: '/v1/chat/completions',
      endpoint: 'Chat completions',
      status: 200,
      startedAt: Date.now(),
      durationMs: 120,
      promptTokens: 1_000,
      completionTokens: 500,
      totalTokens: 1_500,
      streaming: true,
      events: [],
    })
    store.recordTrace({
      id: 'trace-2',
      requestId: 'request-2',
      apiKeyId: generated.key.id,
      apiKeyName: generated.key.userName,
      method: 'POST',
      path: '/v1/embeddings',
      endpoint: 'Embeddings',
      status: 500,
      startedAt: Date.now(),
      durationMs: 900,
      promptTokens: 100,
      completionTokens: 0,
      totalTokens: 100,
      streaming: false,
      events: [],
    })

    const dashboard = store.dashboard(gateway)
    expect(dashboard.summary.requests).toBe(2)
    expect(dashboard.summary.errors).toBe(1)
    expect(dashboard.summary.totalTokens).toBe(1_600)
    expect(dashboard.keys[0]?.cost).toBeCloseTo(0.0031)
    expect(dashboard.endpoints).toEqual(['Chat completions', 'Embeddings'])
    await store.flush()
  })
})

async function makeDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'llama-api-access-'))
  directories.push(directory)
  return directory
}
