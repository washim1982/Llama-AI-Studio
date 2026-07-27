import { execFile, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import extract from 'extract-zip'
import type {
  LlamaFlag,
  RuntimeDevice,
  RuntimeFlavor,
  RuntimeInfo,
  RuntimeResources,
} from '../src/types'

const execFileAsync = promisify(execFile)

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GithubRelease {
  tag_name: string
  assets: ReleaseAsset[]
}

export class RuntimeManager {
  private deviceCache?: { expiresAt: number; devices: RuntimeDevice[] }

  constructor(
    private executablePath: string,
    private readonly runtimeRoot: string,
    private readonly onProgress: (runtime: RuntimeInfo) => void,
  ) {}

  setPath(value: string) {
    this.executablePath = value
    this.deviceCache = undefined
  }

  get path(): string {
    return this.executablePath
  }

  async info(): Promise<RuntimeInfo> {
    const exists = await this.pathExists(this.executablePath)
    if (!exists) return { executablePath: this.executablePath, exists: false }
    try {
      const { stdout, stderr } = await execFileAsync(this.executablePath, ['--version'], {
        windowsHide: true,
        timeout: 10_000,
      })
      const output = `${stdout}\n${stderr}`.trim()
      const version = output.match(/version:\s*([^\r\n]+)/i)?.[1] ?? output.split(/\r?\n/)[0]
      const build = output.match(/build:\s*([^\r\n]+)/i)?.[1]
      return { executablePath: this.executablePath, exists: true, version, build }
    } catch (error) {
      return {
        executablePath: this.executablePath,
        exists: false,
        version: 'llama-server unavailable',
        error: describeRuntimeExecutionError(error),
      }
    }
  }

  async help(): Promise<{ raw: string; flags: LlamaFlag[] }> {
    if (!(await this.pathExists(this.executablePath))) {
      throw new Error('Select or install llama-server.exe first')
    }
    const { stdout, stderr } = await execFileAsync(this.executablePath, ['--help'], {
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    const raw = `${stdout}\n${stderr}`.trim()
    return { raw, flags: parseHelpFlags(raw) }
  }

  async resources(): Promise<RuntimeResources> {
    return {
      devices: await this.listDevices(),
      host: {
        totalBytes: os.totalmem(),
        freeBytes: os.freemem(),
      },
    }
  }

  async listDevices(): Promise<RuntimeDevice[]> {
    if (this.deviceCache && this.deviceCache.expiresAt > Date.now()) {
      return this.deviceCache.devices.map((device) => ({ ...device }))
    }
    if (!(await this.pathExists(this.executablePath))) return []
    let devices: RuntimeDevice[] = []
    try {
      const { stdout, stderr } = await execFileAsync(
        this.executablePath,
        ['--list-devices'],
        {
          windowsHide: true,
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      )
      devices = parseDeviceList(`${stdout}\n${stderr}`)
    } catch {
      // Older llama.cpp builds do not support --list-devices.
    }
    this.deviceCache = {
      expiresAt: Date.now() + 30_000,
      devices,
    }
    return devices.map((device) => ({ ...device }))
  }

  async install(flavor: RuntimeFlavor): Promise<string> {
    this.onProgress({
      executablePath: this.executablePath,
      exists: false,
      installing: flavor,
      installProgress: 0,
      installMessage: 'Checking the latest llama.cpp release…',
    })
    const response = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Llama-Forge-Studio' },
    })
    if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`)
    const release = (await response.json()) as GithubRelease
    const assets = selectAssets(release.assets, flavor)
    if (!assets.length) throw new Error(`No Windows ${flavor} runtime was found in ${release.tag_name}`)

    const installDirectory = path.join(this.runtimeRoot, release.tag_name, flavor)
    await mkdir(installDirectory, { recursive: true })

    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]
      const archivePath = path.join(installDirectory, asset.name)
      await this.download(
        asset.browser_download_url,
        archivePath,
        asset.size,
        flavor,
        index,
        assets.length,
      )
      this.onProgress({
        executablePath: this.executablePath,
        exists: false,
        installing: flavor,
        installProgress: ((index + 0.9) / assets.length) * 100,
        installMessage: `Extracting ${asset.name}…`,
      })
      await extract(archivePath, { dir: installDirectory })
      await rm(archivePath, { force: true })
    }

    const executable = await findFile(installDirectory, 'llama-server.exe')
    if (!executable) throw new Error('The downloaded archive did not contain llama-server.exe')
    this.executablePath = executable
    const result = await this.info()
    this.onProgress({
      ...result,
      installProgress: 100,
      installMessage: result.exists
        ? `${release.tag_name} installed`
        : `${release.tag_name} downloaded but cannot run`,
    })
    if (!result.exists) throw new Error(result.error ?? 'The installed llama-server cannot run')
    return executable
  }

  private async download(
    url: string,
    destination: string,
    expectedSize: number,
    flavor: RuntimeFlavor,
    assetIndex: number,
    assetCount: number,
  ) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Llama-Forge-Studio' },
      redirect: 'follow',
    })
    if (!response.ok || !response.body) {
      throw new Error(`Runtime download failed (${response.status})`)
    }
    const total = Number(response.headers.get('content-length')) || expectedSize
    let received = 0
    const tracker = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        received += chunk.byteLength
        const assetProgress = total > 0 ? received / total : 0
        this.onProgress({
          executablePath: this.executablePath,
          exists: false,
          installing: flavor,
          installProgress: ((assetIndex + assetProgress * 0.85) / assetCount) * 100,
          installMessage: `Downloading runtime ${assetIndex + 1}/${assetCount} · ${Math.round(assetProgress * 100)}%`,
        })
        controller.enqueue(chunk)
      },
    })
    await pipeline(
      Readable.fromWeb(response.body.pipeThrough(tracker) as never),
      createWriteStream(destination),
    )
  }

  private async pathExists(candidate: string): Promise<boolean> {
    if (!candidate) return false
    try {
      await access(candidate)
      return true
    } catch {
      return false
    }
  }
}

export function describeRuntimeExecutionError(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code
  if (typeof code === 'number' && (code >>> 0) === 0xc0e90002) {
    return (
      'Windows Application Control blocked llama-server.exe (0xC0E90002). ' +
      'Ask an administrator to allow-list the llama.cpp runtime folder or use an organization-signed build.'
    )
  }
  if (typeof code === 'number' || typeof code === 'string') {
    return `llama-server.exe could not run (exit code ${String(code)}).`
  }
  return `llama-server.exe could not run: ${
    error instanceof Error ? error.message : String(error)
  }`
}

function selectAssets(assets: ReleaseAsset[], flavor: RuntimeFlavor): ReleaseAsset[] {
  const test = (pattern: RegExp) => assets.find((asset) => pattern.test(asset.name))
  if (flavor === 'cpu') {
    return [test(/^llama-b\d+-bin-win-cpu-x64\.zip$/i)].filter(Boolean) as ReleaseAsset[]
  }
  if (flavor === 'vulkan') {
    return [test(/^llama-b\d+-bin-win-vulkan-x64\.zip$/i)].filter(Boolean) as ReleaseAsset[]
  }
  const major = flavor === 'cuda-12' ? '12' : '13'
  return [
    test(new RegExp(`^llama-b\\d+-bin-win-cuda-${major}[^-]*-x64\\.zip$`, 'i')),
    test(new RegExp(`^cudart-llama-bin-win-cuda-${major}[^-]*-x64\\.zip$`, 'i')),
  ].filter(Boolean) as ReleaseAsset[]
}

async function findFile(directory: string, fileName: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, fileName)
      if (found) return found
    }
  }
  return undefined
}

export function parseHelpFlags(raw: string): LlamaFlag[] {
  const groups: LlamaFlag[] = []
  let group = 'Common'
  let current: LlamaFlag | undefined
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const heading = line.trim().match(/^[-=]*\s*([A-Za-z][\w /-]+(?:params|options))\s*[-=]*$/i)
    if (heading && !line.trim().startsWith('-')) {
      group = heading[1].replace(/\s+params$/i, '').trim()
      continue
    }
    const flagMatch = line.match(/^\s{0,4}((?:-[\w-]+(?:,\s*)?)+)(?:\s+([A-Z][A-Z0-9_<>|,.-]*|\[[^\]]+\]))?\s*(.*)$/)
    if (flagMatch) {
      const names = flagMatch[1].split(',').map((item) => item.trim()).filter(Boolean)
      current = {
        names,
        valueHint: flagMatch[2] ?? '',
        description: flagMatch[3]?.trim() ?? '',
        group,
      }
      groups.push(current)
    } else if (current && line.trim()) {
      current.description = `${current.description} ${line.trim()}`.trim()
    }
  }
  return groups
}

export function parseDeviceList(raw: string): RuntimeDevice[] {
  const devices: RuntimeDevice[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, '').trim()
    const match = line.match(
      /^(.*?)\s*\(\s*([\d.]+)\s*MiB\s*,\s*([\d.]+)\s*MiB\s+free\s*\)\s*$/i,
    )
    if (!match) continue
    const totalMib = Number(match[2])
    const freeMib = Number(match[3])
    if (!Number.isFinite(totalMib) || !Number.isFinite(freeMib) || totalMib <= 0) {
      continue
    }
    const name = match[1].replace(/^(?:device\s+\d+\s*:\s*)/i, '').trim()
    if (!name) continue
    devices.push({
      name,
      totalBytes: totalMib * 1024 ** 2,
      freeBytes: Math.max(0, freeMib) * 1024 ** 2,
    })
  }
  return devices
}
