import { describe, expect, it } from 'vitest'
import {
  describeRuntimeExecutionError,
  parseDeviceList,
  parseHelpFlags,
} from './runtime'

describe('parseHelpFlags', () => {
  it('builds a searchable catalog from llama-server help output', () => {
    const flags = parseHelpFlags(`
Common params
  -t, --threads N              number of CPU threads
  -c, --ctx-size N             size of the prompt context

Server options
  --host HOST                  listen address
  --metrics                    enable Prometheus metrics
`)

    expect(flags).toHaveLength(4)
    expect(flags[0]).toMatchObject({
      names: ['-t', '--threads'],
      valueHint: 'N',
      group: 'Common',
    })
    expect(flags[3].description).toContain('Prometheus')
  })
})

describe('describeRuntimeExecutionError', () => {
  it('identifies Windows Application Control failures', () => {
    expect(describeRuntimeExecutionError({ code: -1058471934 })).toContain(
      'Windows Application Control',
    )
  })
})

describe('parseDeviceList', () => {
  it('reads CUDA and Vulkan free-memory lines', () => {
    expect(
      parseDeviceList(`
CUDA0: NVIDIA RTX 4090 (24564 MiB, 21800 MiB free)
device 1: Vulkan0 (8192 MiB, 7000.5 MiB free)
unknown option: --list-devices
`),
    ).toEqual([
      {
        name: 'CUDA0: NVIDIA RTX 4090',
        totalBytes: 24564 * 1024 ** 2,
        freeBytes: 21800 * 1024 ** 2,
      },
      {
        name: 'Vulkan0',
        totalBytes: 8192 * 1024 ** 2,
        freeBytes: 7000.5 * 1024 ** 2,
      },
    ])
  })
})
