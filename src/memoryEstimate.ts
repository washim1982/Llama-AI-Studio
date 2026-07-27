import type { GgufModel, LoadConfig, RuntimeResources } from './types';

const BYTES_PER_ELEMENT: Record<string, number> = {
  f32: 4,
  f16: 2,
  bf16: 2,
  q8_0: 34 / 32,
  q5_1: 24 / 32,
  q5_0: 22 / 32,
  q4_1: 20 / 32,
  q4_0: 18 / 32,
  iq4_nl: 18 / 32,
};

export interface MemoryEstimate {
  weightsBytes: number;
  kvBytes?: number;
  computeBytes?: number;
  totalBytes?: number;
  contextTokens: number;
  confidence: 'exact' | 'estimated' | 'unavailable';
  notes: string[];
}

const metadataNumber = (model: GgufModel, suffix: string): number | undefined => {
  const direct = model.metadata?.[`${model.architecture}.${suffix}`];
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
  const entry = Object.entries(model.metadata || {}).find(
    ([key, value]) =>
      key.endsWith(`.${suffix}`) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value > 0,
  );
  return typeof entry?.[1] === 'number' ? entry[1] : undefined;
};

export function estimateMemory(
  model: GgufModel,
  config: LoadConfig,
): MemoryEstimate {
  const contextTokens = config.contextSize || model.contextLength || 4096;
  const notes: string[] = [];
  const result: MemoryEstimate = {
    weightsBytes: model.size || 0,
    contextTokens,
    confidence: 'unavailable',
    notes,
  };
  const headCount = metadataNumber(model, 'attention.head_count');
  const kvHeadCount = metadataNumber(model, 'attention.head_count_kv');
  const blockCount = model.blockCount ?? metadataNumber(model, 'block_count');
  const embeddingLength =
    model.embeddingLength ?? metadataNumber(model, 'embedding_length');
  const keyLength = metadataNumber(model, 'attention.key_length');
  const valueLength = metadataNumber(model, 'attention.value_length');
  const kElementBytes = BYTES_PER_ELEMENT[(config.cacheTypeK || 'f16').toLowerCase()];
  const vElementBytes = BYTES_PER_ELEMENT[(config.cacheTypeV || 'f16').toLowerCase()];

  if (
    !headCount ||
    !kvHeadCount ||
    !blockCount ||
    !embeddingLength ||
    !kElementBytes ||
    !vElementBytes
  ) {
    notes.push('KV estimate unavailable — rescan the model to refresh attention metadata.');
    return result;
  }

  const derivedHeadLength = embeddingLength / headCount;
  const kHeadLength = keyLength ?? derivedHeadLength;
  const vHeadLength = valueLength ?? derivedHeadLength;
  if (
    !Number.isFinite(kHeadLength) ||
    !Number.isFinite(vHeadLength) ||
    kHeadLength <= 0 ||
    vHeadLength <= 0
  ) {
    notes.push('KV estimate unavailable because the attention dimensions are invalid.');
    return result;
  }

  const slots = config.parallel > 0 ? config.parallel : 1;
  const kBytes =
    blockCount * contextTokens * kHeadLength * kvHeadCount * kElementBytes * slots;
  const vBytes =
    blockCount * contextTokens * vHeadLength * kvHeadCount * vElementBytes * slots;
  result.kvBytes = kBytes + vBytes;
  result.totalBytes = result.weightsBytes + result.kvBytes;
  result.confidence = keyLength && valueLength ? 'exact' : 'estimated';

  if (config.parallel < 0) notes.push('Automatic slot count is estimated as one slot.');
  else if (slots > 1) notes.push(`${slots} parallel slots multiply the KV allocation.`);
  if (!config.kvOffload) notes.push('KV cache is assigned to host RAM, not VRAM.');
  if (!config.swaFull) {
    notes.push('Sliding-window models may allocate substantially less KV memory.');
  }
  if (
    /moe|mixtral|gpt-oss/i.test(`${model.architecture} ${model.name}`) ||
    metadataNumber(model, 'expert_count')
  ) {
    notes.push('Mixture-of-experts weight residency depends on CPU offload settings.');
  }
  if (model.capabilities?.vision) {
    notes.push('The multimodal projector is not included in this estimate.');
  }
  return result;
}

export function estimateMemoryUsage(
  model: GgufModel,
  config: any,
  freeVramMb?: number
) {
  const est = estimateMemory(model, config as any);
  const weightsMb = Math.round(est.weightsBytes / (1024 * 1024));
  const kvMb = Math.round((est.kvBytes || 0) / (1024 * 1024));
  const totalMb = weightsMb + kvMb;
  let vramWarning = false;
  if (freeVramMb && freeVramMb > 0) {
    vramWarning = totalMb > freeVramMb * 0.9;
  }
  return {
    modelWeightsMb: weightsMb,
    kvCacheMb: kvMb,
    totalEstimatedMb: totalMb,
    vramWarning,
  };
}

export function totalFreeVram(resources?: RuntimeResources): number | undefined {
  if (!resources?.devices.length) return undefined;
  return resources.devices.reduce((total, device) => total + device.freeBytes, 0);
}
