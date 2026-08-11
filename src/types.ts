export type ViewId = 'chat' | 'models' | 'discover' | 'server' | 'admin' | 'settings';

export type RuntimeFlavor = 'cpu' | 'vulkan' | 'cuda-12' | 'cuda-13';

export interface RuntimeDevice {
  name: string;
  totalBytes: number;
  freeBytes: number;
}

export interface RuntimeResources {
  devices: RuntimeDevice[];
  host: {
    totalBytes: number;
    freeBytes: number;
  };
}

export interface RuntimeInfo {
  executablePath: string;
  exists: boolean;
  version?: string;
  build?: string;
  error?: string;
  installing?: RuntimeFlavor;
  installProgress?: number;
  installMessage?: string;
  devices?: RuntimeDevice[];
}

export interface GgufModel {
  id: string;
  apiId: string;
  path: string;
  name: string;
  fileName: string;
  size: number;
  architecture: string;
  parameters: string;
  quantization: string;
  contextLength?: number;
  embeddingLength?: number;
  blockCount?: number;
  hasChatTemplate?: boolean;
  chatTemplate?: string;
  capabilities: {
    vision: boolean;
    embedding: boolean;
    reranker: boolean;
    reasoning: boolean;
    tools: boolean;
  };
  metadata: Record<string, string | number | boolean>;
  importedAt: number;
  sourceRepo?: string;
  mmprojPath?: string;
  validationState?: 'valid' | 'incomplete' | 'invalid';
  validationError?: string;
  isSplit?: boolean;
  splitFilePaths?: string[];
}

export interface LoadConfig {
  onDemandLoading: boolean;
  maxLoadedModels: number;
  contextSize: number;
  threads: number;
  threadsBatch: number;
  batchSize: number;
  ubatchSize: number;
  gpuLayers: string;
  device: string;
  splitMode: 'none' | 'layer' | 'row' | 'tensor';
  tensorSplit: string;
  mainGpu: number;
  fit: 'on' | 'off';
  fitTarget: string;
  flashAttention: 'auto' | 'on' | 'off';
  kvOffload: boolean;
  opOffload: boolean;
  cacheTypeK: string;
  cacheTypeV: string;
  loadMode: 'none' | 'mmap' | 'mlock' | 'dio';
  numa: '' | 'distribute' | 'isolate' | 'numactl';
  swaFull: boolean;
  noHost: boolean;
  repack: boolean;
  cpuMoe: boolean;
  cpuMoeLayers: number;
  checkTensors: boolean;
  ropeScaling: '' | 'none' | 'linear' | 'yarn';
  ropeScale: number;
  ropeFreqBase: number;
  ropeFreqScale: number;
  yarnOriginalContext: number;
  yarnExtFactor: number;
  yarnAttentionFactor: number;
  yarnBetaSlow: number;
  yarnBetaFast: number;
  parallel: number;
  continuousBatching: boolean;
  contextShift: boolean;
  cacheRam: number;
  cacheReuse: number;
  promptCache: boolean;
  warmup: boolean;
  mmprojPath: string;
  mmprojOffload: boolean;
  imageMinTokens: number;
  imageMaxTokens: number;
  imageBatchTokens: number;
  lora: string;
  loraScaled: string;
  controlVector: string;
  controlVectorScaled: string;
  overrideKv: string;
  overrideTensor: string;
  reasoning: 'auto' | 'on' | 'off';
  reasoningFormat: 'auto' | 'none' | 'deepseek' | 'deepseek-legacy';
  reasoningBudget: number;
  reasoningPreserve: boolean;
  jinja: boolean;
  chatTemplate: string;
  chatTemplateFile: string;
  chatTemplateKwargs: string;
  embedding: boolean;
  reranking: boolean;
  pooling: '' | 'none' | 'mean' | 'cls' | 'last' | 'rank';
  embeddingNormalize: number;
  speculativeType: string;
  draftModelPath: string;
  draftGpuLayers: string;
  draftTokensMax: number;
  draftTokensMin: number;
  draftProbabilityMin: number;
  ngramN: number;
  ngramM: number;
  ngramMinHits: number;
  host: string;
  port: number;
  alias: string;
  apiKey: string;
  corsOrigins: string;
  metrics: boolean;
  props: boolean;
  slots: boolean;
  slotSavePath: string;
  mediaPath: string;
  sleepIdleSeconds: number;
  timeout: number;
  httpThreads: number;
  tools: string[];
  agent: boolean;
  extraArgs: string;
}

export interface SamplingConfig {
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  typicalP: number;
  topNSigma: number;
  xtcProbability: number;
  xtcThreshold: number;
  repeatLastN: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
  dryMultiplier: number;
  dryBase: number;
  dryAllowedLength: number;
  dryPenaltyLastN: number;
  adaptiveTarget: number;
  adaptiveDecay: number;
  dynamicTemperatureRange: number;
  dynamicTemperatureExponent: number;
  mirostat: 0 | 1 | 2;
  mirostatTau: number;
  mirostatEta: number;
  seed: number;
  maxTokens: number;
  reasoningEffort: 'auto' | 'none';
  stop: string[];
  ignoreEos: boolean;
  grammar: string;
  jsonSchema: string;
  samplerOrder: string;
}

export interface AppSettings {
  runtimePath: string;
  modelDirectories: string[];
  downloadDirectory: string;
  huggingFaceToken: string;
  startServerOnLaunch: boolean;
  minimizeToTray: boolean;
  theme: 'dark' | 'light' | 'system';
  defaultLoadConfig: LoadConfig;
  defaultSampling: SamplingConfig;
  presets: Preset[];
  offlineMode?: boolean;
  autoPortFallback?: boolean;
  apiGateway: ApiGatewaySettings;
}

export interface ApiGatewaySettings {
  enabled: boolean;
  host: string;
  port: number;
  defaultInputCostPerMillion: number;
  defaultOutputCostPerMillion: number;
}

export interface Preset {
  id: string;
  name: string;
  systemPrompt: string;
  sampling: SamplingConfig;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  path?: string;
  dataUrl?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
  reasoning?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  tokensPerSecond?: number;
  tokens?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  folder: string;
  modelId?: string;
  systemPrompt: string;
  messages: ChatMessage[];
  sampling: SamplingConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSummary {
  id: string;
  title: string;
  folder: string;
  modelId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface RuntimeMemory {
  modelBytes?: number;
  kvBytes?: number;
  computeBytes?: number;
  hostBytes?: number;
  contextTokens?: number;
  offloadedLayers?: string;
  devices?: Array<{ name: string; bytes: number }>;
}

export interface ServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  mode?: 'pinned' | 'on-demand';
  residency?: 'unloaded' | 'loading' | 'loaded' | 'sleeping';
  activeRequests?: number;
  managedModels?: number;
  pid?: number;
  url: string;
  modelId?: string;
  modelApiId?: string;
  modelName?: string;
  startedAt?: number;
  error?: string;
  command?: string;
  memory?: RuntimeMemory;
  kvUsageRatio?: number;
  promptCacheBytes?: number;
}

export interface ApiGatewayStatus {
  state: 'stopped' | 'starting' | 'running' | 'error';
  url: string;
  host: string;
  port: number;
  error?: string;
}

export interface ApiKeyRecord {
  id: string;
  userName: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

export interface CreateApiKeyInput {
  userName: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

export interface GeneratedApiKey {
  key: ApiKeyRecord;
  secret: string;
}

export interface ApiTraceEvent {
  name: 'authenticated' | 'upstream_started' | 'first_byte' | 'usage_captured' | 'completed' | 'failed';
  atMs: number;
  detail?: string;
}

export interface ApiTrace {
  id: string;
  requestId: string;
  apiKeyId?: string;
  apiKeyName: string;
  method: string;
  path: string;
  endpoint: string;
  model?: string;
  status: number;
  startedAt: number;
  durationMs: number;
  timeToFirstByteMs?: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  streaming: boolean;
  clientIp?: string;
  error?: string;
  events: ApiTraceEvent[];
}

export interface ApiUsageSummary {
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  p95LatencyMs: number;
}

export interface ApiKeyUsage extends ApiUsageSummary {
  key: ApiKeyRecord;
  lastRequestAt?: number;
}

export interface ApiUsageBucket {
  startedAt: number;
  requests: number;
  errors: number;
  tokens: number;
  cost: number;
}

export interface AdminDashboardSnapshot {
  gateway: ApiGatewayStatus;
  summary: ApiUsageSummary;
  activeKeys: number;
  keys: ApiKeyUsage[];
  traffic: ApiUsageBucket[];
  traces: ApiTrace[];
  endpoints: string[];
  generatedAt: number;
}

export interface AppState {
  settings: AppSettings;
  runtime: RuntimeInfo;
  models: GgufModel[];
  chats: ChatSummary[];
  server: ServerStatus;
  isScanningModels?: boolean;
}

export interface HfModelSummary {
  id: string;
  author: string;
  name: string;
  downloads: number;
  likes: number;
  lastModified: string;
  tags: string[];
  pipelineTag?: string;
}

export interface HfFile {
  name: string;
  size: number;
  sha256?: string;
  quantization: string;
  isMmproj: boolean;
}

export interface HfModelDetail extends HfModelSummary {
  description: string;
  readme: string;
  files: HfFile[];
}

export interface DownloadProgress {
  id: string;
  repoId: string;
  fileName: string;
  received: number;
  total: number;
  percent: number;
  state: 'downloading' | 'verifying' | 'completed' | 'cancelled' | 'error';
  message?: string;
  destination?: string;
}

export interface ChatRequest {
  requestId: string;
  model: string;
  messages: ChatMessage[];
  systemPrompt: string;
  sampling: SamplingConfig;
}

export interface ChatChunk {
  requestId: string;
  content?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  done?: boolean;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface LlamaFlag {
  names: string[];
  valueHint: string;
  description: string;
  group: string;
}

export interface ElectronApi {
  getState: () => Promise<AppState>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  chooseRuntime: () => Promise<RuntimeInfo>;
  installRuntime: (flavor: RuntimeFlavor) => Promise<void>;
  getRuntimeHelp: () => Promise<{ raw: string; flags: LlamaFlag[] }>;
  getRuntimeResources: () => Promise<RuntimeResources>;
  chooseModelFiles: () => Promise<GgufModel[]>;
  chooseModelDirectory: () => Promise<GgufModel[]>;
  scanModels: () => Promise<GgufModel[]>;
  removeModelFolder?: (folderPath: string) => Promise<AppSettings>;
  removeModel: (id: string) => Promise<GgufModel[]>;
  getModelTemplate: (id: string) => Promise<string | undefined>;
  chooseAuxiliaryFile: (kind: 'mmproj' | 'draft' | 'lora' | 'grammar' | 'template' | 'directory') => Promise<string>;
  chooseImages: () => Promise<Attachment[]>;
  getModels: () => Promise<GgufModel[]>;
  loadChat: (id: string) => Promise<ChatSession>;
  saveChat: (chat: ChatSession) => Promise<{ chat: ChatSession; chats: ChatSummary[] }>;
  deleteChat: (id: string) => Promise<ChatSummary[]>;
  startServer: (modelId: string, config: LoadConfig) => Promise<ServerStatus>;
  stopServer: () => Promise<ServerStatus>;
  releaseServerMemory: () => Promise<ServerStatus>;
  getServerStatus: () => Promise<ServerStatus>;
  getServerLogs: () => Promise<string[]>;
  getAdminDashboard: () => Promise<AdminDashboardSnapshot>;
  createApiKey: (input: CreateApiKeyInput) => Promise<GeneratedApiKey>;
  revokeApiKey: (id: string) => Promise<ApiKeyRecord>;
  chat: (request: ChatRequest) => Promise<void>;
  cancelChat: (requestId: string) => Promise<void>;
  searchHuggingFace: (query: string) => Promise<HfModelSummary[]>;
  getHuggingFaceModel: (repoId: string) => Promise<HfModelDetail>;
  downloadHuggingFaceFile: (
    repoId: string,
    fileName: string,
    expectedSize?: number,
    sha256?: string,
  ) => Promise<{ id: string }>;
  cancelDownload: (id: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (path: string) => Promise<void>;
  onServerStatus: (callback: (status: ServerStatus) => void) => () => void;
  onServerLog: (callback: (line: string) => void) => () => void;
  onAdminUpdated: (callback: (snapshot: AdminDashboardSnapshot) => void) => () => void;
  onChatChunk: (callback: (chunk: ChatChunk) => void) => () => void;
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  onRuntimeProgress: (callback: (runtime: RuntimeInfo) => void) => () => void;
  onModelsUpdated?: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    forge: ElectronApi;
  }
}
