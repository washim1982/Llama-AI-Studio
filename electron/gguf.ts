import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import * as fs from 'fs';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
import type { GgufModel } from '../src/types';

const GGUF_MAGIC = 0x46554747;

const TYPE_SIZES: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
};

class GgufReader {
  private position = 0;

  constructor(private readonly handle: FileHandle) {}

  get offset(): number {
    return this.position;
  }

  private async read(length: number): Promise<Buffer> {
    const buffer = Buffer.allocUnsafe(length);
    const result = await this.handle.read(buffer, 0, length, this.position);
    if (result.bytesRead !== length) throw new Error('Unexpected end of GGUF file');
    this.position += length;
    return buffer;
  }

  async uint8(): Promise<number> {
    return (await this.read(1)).readUInt8(0);
  }

  async int8(): Promise<number> {
    return (await this.read(1)).readInt8(0);
  }

  async uint16(): Promise<number> {
    return (await this.read(2)).readUInt16LE(0);
  }

  async int16(): Promise<number> {
    return (await this.read(2)).readInt16LE(0);
  }

  async uint32(): Promise<number> {
    return (await this.read(4)).readUInt32LE(0);
  }

  async int32(): Promise<number> {
    return (await this.read(4)).readInt32LE(0);
  }

  async float32(): Promise<number> {
    return (await this.read(4)).readFloatLE(0);
  }

  async uint64(): Promise<bigint> {
    return (await this.read(8)).readBigUInt64LE(0);
  }

  async int64(): Promise<bigint> {
    return (await this.read(8)).readBigInt64LE(0);
  }

  async float64(): Promise<number> {
    return (await this.read(8)).readDoubleLE(0);
  }

  async string(keep = true): Promise<string> {
    const lengthOffset = this.position;
    const length = Number(await this.uint64());
    if (!Number.isSafeInteger(length) || length < 0 || length > 256 * 1024 * 1024) {
      throw new Error(`Invalid GGUF string length ${length} at offset ${lengthOffset}`);
    }
    if (!keep) {
      this.position += length;
      return '';
    }
    return (await this.read(length)).toString('utf8');
  }

  async value(type: number, keep = true): Promise<string | number | boolean> {
    switch (type) {
      case 0:
        return this.uint8();
      case 1:
        return this.int8();
      case 2:
        return this.uint16();
      case 3:
        return this.int16();
      case 4:
        return this.uint32();
      case 5:
        return this.int32();
      case 6:
        return this.float32();
      case 7:
        return Boolean(await this.uint8());
      case 8:
        return this.string(keep);
      case 10:
        return Number(await this.uint64());
      case 11:
        return Number(await this.int64());
      case 12:
        return this.float64();
      case 9: {
        const elementType = await this.uint32();
        const count = Number(await this.uint64());
        if (!Number.isSafeInteger(count) || count < 0 || count > 100_000_000) {
          throw new Error('Invalid GGUF array length');
        }
        const fixedSize = TYPE_SIZES[elementType];
        if (fixedSize) {
          this.position += fixedSize * count;
          return `[${count} values]`;
        }
        if (elementType === 8) {
          for (let index = 0; index < count; index += 1) {
            try {
              await this.string(false);
            } catch (error) {
              throw new Error(
                `Invalid string ${index + 1}/${count}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
          return `[${count} strings]`;
        }
        for (let index = 0; index < count; index += 1) await this.value(elementType, false);
        return `[${count} values]`;
      }
      default:
        throw new Error(`Unsupported GGUF metadata type ${type}`);
    }
  }
}

const quantFromName = (fileName: string): string => {
  const match = fileName.match(
    /(?:^|[-_.])((?:IQ|Q|TQ|BF|F)\d(?:_[A-Z0-9]+)*)(?:[-_.]|$)/i,
  );
  return match?.[1]?.toUpperCase() ?? 'Unknown';
};

const parameterLabel = (metadata: Record<string, string | number | boolean>): string => {
  const label = metadata['general.size_label'];
  if (typeof label === 'string' && label) return label.toUpperCase();
  const count = metadata['general.parameter_count'];
  if (typeof count !== 'number') return 'Unknown';
  if (count >= 1e12) return `${(count / 1e12).toFixed(1)}T`;
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  return count.toLocaleString();
};

const interestingKey = (key: string): boolean =>
  key.startsWith('general.') ||
  key.endsWith('.context_length') ||
  key.endsWith('.embedding_length') ||
  key.endsWith('.block_count') ||
  key.endsWith('.attention.head_count') ||
  key.endsWith('.attention.head_count_kv') ||
  key.endsWith('.attention.key_length') ||
  key.endsWith('.attention.value_length') ||
  key.includes('pooling_type');

const isChatTemplateKey = (key: string): boolean => key.includes('chat_template');

export async function inspectGguf(filePath: string): Promise<GgufModel> {
  const handle = await open(filePath, 'r');
  try {
    const reader = new GgufReader(handle);
    if ((await reader.uint32()) !== GGUF_MAGIC) throw new Error('Not a GGUF file');
    const version = await reader.uint32();
    if (version < 2 || version > 3) throw new Error(`Unsupported GGUF version ${version}`);
    await reader.uint64();
    const metadataCount = Number(await reader.uint64());
    if (metadataCount > 100_000) throw new Error('Invalid GGUF metadata count');

    const metadata: Record<string, string | number | boolean> = {};
    let template = '';
    for (let index = 0; index < metadataCount; index += 1) {
      let key = '<unread>';
      let type = -1;
      try {
        key = await reader.string();
        type = await reader.uint32();
        const templateKey = isChatTemplateKey(key);
        const keep = interestingKey(key) || templateKey;
        const value = await reader.value(type, keep);
        if (templateKey && typeof value === 'string' && value && !template) {
          template = value;
        } else if (interestingKey(key)) {
          metadata[key] = value;
        }
      } catch (error) {
        throw new Error(
          `Invalid GGUF metadata at entry ${index + 1}/${metadataCount}, key ${key}, type ${type}, offset ${reader.offset}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const stats = await stat(filePath);
    const architecture = String(metadata['general.architecture'] ?? 'unknown');
    const name = String(
      metadata['general.name'] ??
        metadata['general.basename'] ??
        path.basename(filePath, path.extname(filePath)),
    );
    const lowerName = `${name} ${path.basename(filePath)}`.toLowerCase();
    const isMmproj = lowerName.includes('mmproj') || metadata['general.type'] === 'mmproj';
    const context = metadata[`${architecture}.context_length`];
    const embedding = metadata[`${architecture}.embedding_length`];
    const blocks = metadata[`${architecture}.block_count`];

    const id = createHash('sha1').update(path.resolve(filePath).toLowerCase()).digest('hex');
    const apiBase = path.basename(filePath, path.extname(filePath));
    return {
      id,
      apiId: `${apiBase.replace(/[^\w.-]+/g, '-')}-${id.slice(0, 7)}`,
      path: path.resolve(filePath),
      name,
      fileName: path.basename(filePath),
      size: stats.size,
      architecture,
      parameters: parameterLabel(metadata),
      quantization: quantFromName(path.basename(filePath)),
      contextLength: typeof context === 'number' ? context : undefined,
      embeddingLength: typeof embedding === 'number' ? embedding : undefined,
      blockCount: typeof blocks === 'number' ? blocks : undefined,
      hasChatTemplate: Boolean(template),
      capabilities: {
        vision: isMmproj || lowerName.includes('vision') || lowerName.includes('vl-'),
        embedding:
          lowerName.includes('embed') ||
          metadata['general.type'] === 'embedding' ||
          String(metadata['general.tags'] ?? '').includes('embedding'),
        reranker: lowerName.includes('rerank'),
        reasoning:
          /think|reasoning|deepseek|qwen3|gpt-oss/i.test(`${template} ${lowerName}`),
        tools: /tool|function/i.test(template),
      },
      metadata,
      importedAt: Date.now(),
      sourceRepo:
        typeof metadata['general.source.url'] === 'string'
          ? String(metadata['general.source.url'])
          : undefined,
      validationState: 'valid',
    };
  } finally {
    await handle.close();
  }
}

export function parseGgufHeader(filePath: string): GgufModel {
  const stats = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const resolvedPath = path.resolve(filePath);
  const id = createHash('sha1').update(resolvedPath.toLowerCase()).digest('hex');
  const name = fileName.replace(/\.gguf$/i, '');
  const lowerName = fileName.toLowerCase();

  return {
    id,
    apiId: `${name.replace(/[^\w.-]+/g, '-')}-${id.slice(0, 7)}`,
    path: resolvedPath,
    name,
    fileName,
    size: stats.size,
    architecture: 'llama',
    parameters: '7B',
    quantization: quantFromName(fileName),
    contextLength: 8192,
    embeddingLength: 4096,
    blockCount: 32,
    hasChatTemplate: false,
    capabilities: {
      vision: lowerName.includes('mmproj') || lowerName.includes('vision') || lowerName.includes('vl-'),
      embedding: lowerName.includes('embed') || lowerName.includes('bge'),
      reranker: lowerName.includes('rerank'),
      reasoning: /think|reasoning|deepseek|qwen3/i.test(lowerName),
      tools: lowerName.includes('tool'),
    },
    metadata: {},
    importedAt: stats.mtimeMs,
    validationState: 'valid',
  };
}

export async function readGgufChatTemplate(
  filePath: string,
): Promise<string | undefined> {
  const handle = await open(filePath, 'r');
  try {
    const reader = new GgufReader(handle);
    if ((await reader.uint32()) !== GGUF_MAGIC) throw new Error('Not a GGUF file');
    const version = await reader.uint32();
    if (version < 2 || version > 3) throw new Error(`Unsupported GGUF version ${version}`);
    await reader.uint64();
    const metadataCount = Number(await reader.uint64());
    if (metadataCount > 100_000) throw new Error('Invalid GGUF metadata count');
    for (let index = 0; index < metadataCount; index += 1) {
      const key = await reader.string();
      const type = await reader.uint32();
      const value = await reader.value(type, isChatTemplateKey(key));
      if (isChatTemplateKey(key) && typeof value === 'string' && value) return value;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

export async function describeUnavailableGguf(
  filePath: string,
  validationState: 'incomplete' | 'invalid',
  validationError: string,
): Promise<GgufModel> {
  const stats = await stat(filePath);
  const resolvedPath = path.resolve(filePath);
  const fileName = path.basename(filePath);
  const displayFileName = fileName.replace(/\.partial$/i, '');
  const name = displayFileName.replace(/\.gguf$/i, '');
  const id = createHash('sha1').update(resolvedPath.toLowerCase()).digest('hex');
  const apiBase = name.replace(/[^\w.-]+/g, '-') || 'model';
  return {
    id,
    apiId: `${apiBase}-${id.slice(0, 7)}`,
    path: resolvedPath,
    name,
    fileName,
    size: stats.size,
    architecture: validationState === 'incomplete' ? 'incomplete' : 'invalid',
    parameters: 'Unknown',
    quantization: quantFromName(displayFileName),
    capabilities: {
      vision: false,
      embedding: false,
      reranker: false,
      reasoning: /think|reasoning|deepseek|qwen3/i.test(name),
      tools: false,
    },
    metadata: {},
    importedAt: stats.mtimeMs,
    validationState,
    validationError,
  };
}
