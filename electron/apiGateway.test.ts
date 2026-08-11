import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiGatewaySettings } from '../src/types'
import { ApiAccessStore } from './apiAccess'
import { ApiGateway, UsageTracker, describeEndpoint, extractUsage } from './apiGateway'

const cleanup: Array<() => Promise<unknown>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((operation) => operation()))
})

describe('API gateway metering', () => {
  it('extracts usage from OpenAI and llama.cpp response shapes', () => {
    expect(extractUsage({ usage: { prompt_tokens: 12, completion_tokens: 7 } })).toEqual({
      promptTokens: 12,
      completionTokens: 7,
    })
    expect(extractUsage({ timings: { prompt_n: 9, predicted_n: 4 } })).toEqual({
      promptTokens: 9,
      completionTokens: 4,
    })
    expect(describeEndpoint('POST', '/v1/chat/completions')).toBe('Chat completions')
  })

  it('captures usage from chunked SSE events', () => {
    const tracker = new UsageTracker()
    tracker.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n'), 'text/event-stream')
    tracker.push(new TextEncoder().encode('\ndata: {"usage":{"prompt_tokens":21,"completion_tokens":8}}\n\ndata: [DONE]\n\n'), 'text/event-stream')
    expect(tracker.finish()).toMatchObject({ promptTokens: 21, completionTokens: 8 })
  })

  it('authenticates, proxies, and records a billed request', async () => {
    let upstreamAuthorization = ''
    const upstream = createServer(async (request, response) => {
      upstreamAuthorization = request.headers.authorization ?? ''
      for await (const _chunk of request) {
        // Drain the request before replying.
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ id: 'chat-1', usage: { prompt_tokens: 100, completion_tokens: 25 } }))
    })
    const upstreamUrl = await startServer(upstream)
    cleanup.push(() => closeServer(upstream))

    const directory = await mkdtemp(path.join(tmpdir(), 'llama-gateway-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const access = new ApiAccessStore(directory)
    await access.initialize()
    const settings: ApiGatewaySettings = {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      defaultInputCostPerMillion: 2,
      defaultOutputCostPerMillion: 10,
    }
    const generated = access.createKey({ userName: 'SDK client' }, settings)
    const gateway = new ApiGateway(
      () => settings,
      () => ({ url: upstreamUrl, apiKey: 'internal-secret', running: true }),
      access,
      () => undefined,
    )
    await gateway.start()
    cleanup.push(() => gateway.stop())

    const unauthorized = await fetch(`${gateway.currentStatus().url}/v1/models`)
    expect(unauthorized.status).toBe(401)
    const proxied = await fetch(`${gateway.currentStatus().url}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${generated.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'local-model', messages: [], stream: false }),
    })
    expect(proxied.status).toBe(200)
    expect(upstreamAuthorization).toBe('Bearer internal-secret')

    const dashboard = access.dashboard(gateway.currentStatus())
    expect(dashboard.summary.requests).toBe(2)
    expect(dashboard.keys[0]?.requests).toBe(1)
    expect(dashboard.keys[0]?.totalTokens).toBe(125)
    expect(dashboard.keys[0]?.cost).toBeCloseTo(0.00045)
    expect(dashboard.traces[0]?.model).toBe('local-model')
    expect(dashboard.traces[0]?.events.map((event) => event.name)).toContain('usage_captured')
    await access.flush()
  })
})

function startServer(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('Missing test server address'))
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
