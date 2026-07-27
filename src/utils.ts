import type { ChatSession, ElectronApi, SamplingConfig } from './types'

export function getForgeApi(): ElectronApi | undefined {
  return window.forge || (window as any).forgeApi || (window as any).electron
}

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[index]}`
}

export const formatCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

export const timeAgo = (dateString: string): string => {
  const timestamp = new Date(dateString).getTime()
  if (!timestamp) return 'recently'
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export const defaultSamplingConfig: SamplingConfig = {
  temperature: 0.8,
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  typicalP: 1,
  topNSigma: -1,
  xtcProbability: 0,
  xtcThreshold: 0.1,
  repeatLastN: 64,
  repeatPenalty: 1,
  presencePenalty: 0,
  frequencyPenalty: 0,
  dryMultiplier: 0,
  dryBase: 1.75,
  dryAllowedLength: 2,
  dryPenaltyLastN: -1,
  adaptiveTarget: -1,
  adaptiveDecay: 0.9,
  dynamicTemperatureRange: 0,
  dynamicTemperatureExponent: 1,
  mirostat: 0,
  mirostatTau: 5,
  mirostatEta: 0.1,
  seed: -1,
  maxTokens: 2048,
  reasoningEffort: 'auto',
  stop: [],
  ignoreEos: false,
  grammar: '',
  jsonSchema: '',
  samplerOrder: 'penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature',
};

export const createChat = (
  samplingOrModelId?: SamplingConfig | string,
  sampling?: SamplingConfig,
): ChatSession => {
  const modelId = typeof samplingOrModelId === 'string' ? samplingOrModelId : undefined;
  const config = typeof samplingOrModelId === 'object' ? samplingOrModelId : (sampling || defaultSamplingConfig);

  return {
    id: crypto.randomUUID(),
    title: 'New conversation',
    folder: '',
    systemPrompt: '',
    modelId,
    messages: [],
    sampling: { ...config, stop: [...(config.stop || [])] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const copyText = async (value: string) => {
  await navigator.clipboard.writeText(value)
}
