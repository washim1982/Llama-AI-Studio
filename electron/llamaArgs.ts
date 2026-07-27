import type { LoadConfig } from '../src/types'

const addValue = (
  args: string[],
  flag: string,
  value: string | number,
  predicate = true,
) => {
  if (predicate && value !== '') args.push(flag, String(value))
}

const addBoolean = (args: string[], enabled: boolean, on: string, off?: string) => {
  if (enabled) args.push(on)
  else if (off) args.push(off)
}

export function tokenizeArguments(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  for (const character of input.trim()) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote === '"') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (quote) throw new Error('Unclosed quote in extra llama.cpp arguments')
  if (current) tokens.push(current)
  return tokens
}

export function buildLlamaServerArgs(modelPath: string, config: LoadConfig): string[] {
  return ['--model', modelPath, ...buildCommonLlamaArgs(config, true)]
}

export function buildLlamaRouterArgs(presetPath: string, config: LoadConfig): string[] {
  return [
    '--models-preset',
    presetPath,
    '--models-max',
    String(Math.max(1, config.maxLoadedModels)),
    '--models-autoload',
    ...buildCommonLlamaArgs(config, false),
  ]
}

function buildCommonLlamaArgs(config: LoadConfig, includeAlias: boolean): string[] {
  const args = ['--host', config.host, '--port', String(config.port)]
  addValue(args, '--ctx-size', config.contextSize, config.contextSize > 0)
  addValue(args, '--threads', config.threads, config.threads > 0)
  addValue(args, '--threads-batch', config.threadsBatch, config.threadsBatch > 0)
  addValue(args, '--batch-size', config.batchSize, config.batchSize > 0)
  addValue(args, '--ubatch-size', config.ubatchSize, config.ubatchSize > 0)
  addValue(args, '--n-gpu-layers', config.gpuLayers)
  addValue(args, '--device', config.device, Boolean(config.device))
  addValue(args, '--split-mode', config.splitMode)
  addValue(args, '--tensor-split', config.tensorSplit, Boolean(config.tensorSplit))
  addValue(args, '--main-gpu', config.mainGpu)
  addValue(args, '--fit', config.fit)
  addValue(args, '--fit-target', config.fitTarget, Boolean(config.fitTarget))
  addValue(args, '--flash-attn', config.flashAttention)
  addBoolean(args, config.kvOffload, '--kv-offload', '--no-kv-offload')
  addBoolean(args, config.opOffload, '--op-offload', '--no-op-offload')
  addValue(args, '--cache-type-k', config.cacheTypeK)
  addValue(args, '--cache-type-v', config.cacheTypeV)
  addValue(args, '--load-mode', config.loadMode)
  addValue(args, '--numa', config.numa, Boolean(config.numa))
  addBoolean(args, config.swaFull, '--swa-full')
  addBoolean(args, config.noHost, '--no-host')
  addBoolean(args, config.repack, '--repack', '--no-repack')
  addBoolean(args, config.cpuMoe, '--cpu-moe')
  addValue(args, '--n-cpu-moe', config.cpuMoeLayers, config.cpuMoeLayers > 0)
  addBoolean(args, config.checkTensors, '--check-tensors')
  addValue(args, '--rope-scaling', config.ropeScaling, Boolean(config.ropeScaling))
  addValue(args, '--rope-scale', config.ropeScale, config.ropeScale > 0)
  addValue(args, '--rope-freq-base', config.ropeFreqBase, config.ropeFreqBase > 0)
  addValue(args, '--rope-freq-scale', config.ropeFreqScale, config.ropeFreqScale > 0)
  addValue(args, '--yarn-orig-ctx', config.yarnOriginalContext, config.yarnOriginalContext > 0)
  addValue(args, '--yarn-ext-factor', config.yarnExtFactor, config.yarnExtFactor >= 0)
  addValue(args, '--yarn-attn-factor', config.yarnAttentionFactor, config.yarnAttentionFactor >= 0)
  addValue(args, '--yarn-beta-slow', config.yarnBetaSlow, config.yarnBetaSlow >= 0)
  addValue(args, '--yarn-beta-fast', config.yarnBetaFast, config.yarnBetaFast >= 0)
  addValue(args, '--parallel', config.parallel)
  addBoolean(args, config.continuousBatching, '--cont-batching', '--no-cont-batching')
  addBoolean(args, config.contextShift, '--context-shift', '--no-context-shift')
  addValue(args, '--cache-ram', config.cacheRam, config.cacheRam > 0)
  addValue(args, '--cache-reuse', config.cacheReuse, config.cacheReuse > 0)
  addBoolean(args, config.promptCache, '--cache-prompt', '--no-cache-prompt')
  addBoolean(args, config.warmup, '--warmup', '--no-warmup')
  addValue(args, '--mmproj', config.mmprojPath, Boolean(config.mmprojPath))
  addBoolean(args, config.mmprojOffload, '--mmproj-offload', '--no-mmproj-offload')
  addValue(args, '--image-min-tokens', config.imageMinTokens, config.imageMinTokens > 0)
  addValue(args, '--image-max-tokens', config.imageMaxTokens, config.imageMaxTokens > 0)
  addValue(args, '--mtmd-batch-max-tokens', config.imageBatchTokens, config.imageBatchTokens > 0)
  addValue(args, '--lora', config.lora, Boolean(config.lora))
  addValue(args, '--lora-scaled', config.loraScaled, Boolean(config.loraScaled))
  addValue(args, '--control-vector', config.controlVector, Boolean(config.controlVector))
  addValue(
    args,
    '--control-vector-scaled',
    config.controlVectorScaled,
    Boolean(config.controlVectorScaled),
  )
  addValue(args, '--override-kv', config.overrideKv, Boolean(config.overrideKv))
  addValue(args, '--override-tensor', config.overrideTensor, Boolean(config.overrideTensor))
  addValue(args, '--reasoning', config.reasoning)
  addValue(
    args,
    '--reasoning-format',
    config.reasoningFormat,
    config.reasoningFormat !== 'auto',
  )
  addValue(args, '--reasoning-budget', config.reasoningBudget, config.reasoningBudget >= 0)
  addBoolean(args, config.reasoningPreserve, '--reasoning-preserve')
  addBoolean(args, config.jinja, '--jinja', '--no-jinja')
  addValue(args, '--chat-template', config.chatTemplate, Boolean(config.chatTemplate))
  addValue(args, '--chat-template-file', config.chatTemplateFile, Boolean(config.chatTemplateFile))
  addValue(
    args,
    '--chat-template-kwargs',
    config.chatTemplateKwargs,
    Boolean(config.chatTemplateKwargs),
  )
  addBoolean(args, config.embedding, '--embedding')
  addBoolean(args, config.reranking, '--reranking')
  addValue(args, '--pooling', config.pooling, Boolean(config.pooling))
  addValue(args, '--embd-normalize', config.embeddingNormalize, config.embedding)
  if (config.speculativeType && config.speculativeType !== 'none') {
    addValue(args, '--spec-type', config.speculativeType)
    addValue(args, '--spec-draft-model', config.draftModelPath, Boolean(config.draftModelPath))
    addValue(args, '--spec-draft-ngl', config.draftGpuLayers)
    addValue(args, '--spec-draft-n-max', config.draftTokensMax, config.draftTokensMax > 0)
    addValue(args, '--spec-draft-n-min', config.draftTokensMin, config.draftTokensMin > 0)
    addValue(args, '--spec-draft-p-min', config.draftProbabilityMin, config.draftProbabilityMin > 0)
    if (config.speculativeType.startsWith('ngram')) {
      const prefix = `--spec-${config.speculativeType}`
      addValue(args, `${prefix}-size-n`, config.ngramN)
      addValue(args, `${prefix}-size-m`, config.ngramM)
      addValue(args, `${prefix}-min-hits`, config.ngramMinHits)
    }
  }
  addValue(args, '--alias', config.alias, includeAlias && Boolean(config.alias))
  addValue(args, '--api-key', config.apiKey, Boolean(config.apiKey))
  addValue(args, '--cors-origins', config.corsOrigins, Boolean(config.corsOrigins))
  addBoolean(args, config.metrics, '--metrics')
  addBoolean(args, config.props, '--props')
  addBoolean(args, config.slots, '--slots', '--no-slots')
  addValue(args, '--slot-save-path', config.slotSavePath, Boolean(config.slotSavePath))
  addValue(args, '--media-path', config.mediaPath, Boolean(config.mediaPath))
  addValue(args, '--sleep-idle-seconds', config.sleepIdleSeconds, config.sleepIdleSeconds > 0)
  addValue(args, '--timeout', config.timeout, config.timeout > 0)
  addValue(args, '--threads-http', config.httpThreads, config.httpThreads > 0)
  if (config.tools.length) addValue(args, '--tools', config.tools.join(','))
  addBoolean(args, config.agent, '--agent')
  args.push('--no-ui')
  args.push(...tokenizeArguments(config.extraArgs))
  return args
}
