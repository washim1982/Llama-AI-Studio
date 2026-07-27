export type DeveloperTopicId =
  | 'authentication'
  | 'server-lifecycle'
  | 'local-network'
  | 'chat-completions'
  | 'responses'
  | 'structured-output'
  | 'tools-functions'
  | 'embeddings'
  | 'completions'
  | 'infill'
  | 'reranking'
  | 'slots-metrics';

export interface DeveloperEndpoint {
  method: 'GET' | 'POST';
  path: string;
  description: string;
}

export interface DeveloperField {
  name: string;
  description: string;
  required?: boolean;
}

export interface DeveloperTopic {
  id: DeveloperTopicId;
  title: string;
  group: 'Core' | 'OpenAI compatible' | 'Native llama.cpp';
  summary: string;
  endpoints: DeveloperEndpoint[];
  setup: string[];
  fields: DeveloperField[];
  requestLabel: string;
  request: string;
  responseLabel: string;
  response: string;
}

export const developerTopics: DeveloperTopic[] = [
  {
    id: 'authentication',
    title: 'Authentication',
    group: 'Core',
    summary:
      'Protect local endpoints with a bearer token. The health endpoint stays public so clients can perform readiness checks.',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Public readiness check' },
      { method: 'GET', path: '/v1/models', description: 'Protected when an API key is configured' },
    ],
    setup: [
      'Set API key under Server settings → Serving & endpoints before starting the server.',
      'Send the key as Authorization: Bearer <key>. Multiple runtime keys can be supplied through advanced arguments.',
      'Do not treat CORS as authentication; keep the server bound to localhost unless remote access is intentional.',
    ],
    fields: [
      { name: 'Authorization', description: 'HTTP header containing Bearer followed by the configured key.', required: true },
      { name: 'Content-Type', description: 'Use application/json for endpoints with a JSON request body.' },
      { name: 'x-api-key', description: 'Accepted by Anthropic-compatible /v1/messages clients.' },
    ],
    requestLabel: 'Authenticated request',
    request: `curl {{BASE_URL}}/v1/models \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
    responseLabel: 'Authentication error',
    response: `{
  "error": {
    "code": 401,
    "message": "Invalid API Key",
    "type": "authentication_error"
  }
}`,
  },
  {
    id: 'server-lifecycle',
    title: 'Server lifecycle',
    group: 'Core',
    summary:
      'Start, stop, and observe llama-server from the Studio. Health and model-list endpoints let external clients wait until inference is ready.',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Returns 200 when ready or 503 while loading' },
      { method: 'GET', path: '/v1/models', description: 'Lists the model exposed to OpenAI clients' },
      { method: 'GET', path: '/props', description: 'Reports runtime and model properties' },
    ],
    setup: [
      'Pinned mode loads the selected model before accepting inference.',
      'On-demand mode keeps the API manager available and loads a model when a request names it.',
      'Use the Stop server or Stop manager button for a clean shutdown and Release model memory to free GPU/RAM.',
    ],
    fields: [
      { name: 'status', description: 'The health response is ok after the model is ready.' },
      { name: 'model', description: 'Request-body model ID used for routing in on-demand mode.' },
      { name: 'model query', description: 'GET endpoints in router mode accept ?model=<model-id>.' },
    ],
    requestLabel: 'Readiness checks',
    request: `curl {{BASE_URL}}/health
curl {{BASE_URL}}/v1/models`,
    responseLabel: 'Ready response',
    response: `{
  "status": "ok"
}`,
  },
  {
    id: 'local-network',
    title: 'Local network',
    group: 'Core',
    summary:
      'Control which network interfaces can reach the API and which browser origins may call it.',
    endpoints: [
      { method: 'GET', path: '/health', description: 'Test reachability from another computer' },
    ],
    setup: [
      'Use host 127.0.0.1 for access from this computer only.',
      'Use host 0.0.0.0 to listen on the LAN, then connect with this computer’s LAN IP and configured port.',
      'Add only trusted browser origins to CORS and allow the port through Windows Firewall if LAN access is required.',
      'Configure an API key before exposing the server beyond localhost. TLS or a trusted reverse proxy is recommended.',
    ],
    fields: [
      { name: 'Host', description: '127.0.0.1 for local-only; 0.0.0.0 for all IPv4 interfaces.', required: true },
      { name: 'Port', description: 'TCP port used by llama-server. The default is 8080.', required: true },
      { name: 'CORS origins', description: 'Comma-separated browser origins permitted to call the API.' },
      { name: 'API key', description: 'Bearer token required for protected endpoints.' },
    ],
    requestLabel: 'Test from another LAN device',
    request: `curl http://YOUR_PC_LAN_IP:8080/health`,
    responseLabel: 'Reachable response',
    response: `{
  "status": "ok"
}`,
  },
  {
    id: 'chat-completions',
    title: 'Chat completions',
    group: 'OpenAI compatible',
    summary:
      'Generate assistant messages from a role-based conversation using the widely supported OpenAI Chat Completions shape.',
    endpoints: [
      { method: 'POST', path: '/v1/chat/completions', description: 'Synchronous or streamed chat generation' },
      { method: 'POST', path: '/v1/chat/completions/input_tokens', description: 'Count request tokens without generating' },
    ],
    setup: [
      'Use the OpenAI base URL shown above and any non-empty client key when server authentication is disabled.',
      'A model with a compatible chat template produces the best role and tool formatting.',
      'Set stream to true for Server-Sent Events; each chunk contains an incremental delta.',
    ],
    fields: [
      { name: 'model', description: 'Loaded model ID, alias, or default for the selected on-demand model.', required: true },
      { name: 'messages', description: 'Ordered role/content messages forming the conversation.', required: true },
      { name: 'max_tokens', description: 'Maximum number of new tokens to generate.' },
      { name: 'stream', description: 'Return incremental Server-Sent Event chunks when true.' },
      { name: 'temperature / top_p', description: 'Sampling controls; usually tune one before changing both.' },
    ],
    requestLabel: 'Chat request',
    request: `curl {{BASE_URL}}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer local" \\
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "max_tokens": 64
  }'`,
    responseLabel: 'Response shape',
    response: `{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 16,
    "completion_tokens": 9,
    "total_tokens": 25
  }
}`,
  },
  {
    id: 'responses',
    title: 'Responses',
    group: 'OpenAI compatible',
    summary:
      'Use the unified Responses-style input format for text generation. llama-server converts the request through its chat-completions engine.',
    endpoints: [
      { method: 'POST', path: '/v1/responses', description: 'Create a response from text or structured input' },
      { method: 'POST', path: '/v1/responses/input_tokens', description: 'Count response input tokens' },
    ],
    setup: [
      'Use input for the user request and instructions for system-level behavior.',
      'Read output_text in compatible SDKs, or inspect the output item array in raw JSON.',
      'Feature coverage follows the installed llama.cpp runtime and model chat template.',
    ],
    fields: [
      { name: 'model', description: 'Loaded model ID, alias, or default.', required: true },
      { name: 'input', description: 'Text or an array of response input items.', required: true },
      { name: 'instructions', description: 'System/developer guidance applied to this response.' },
      { name: 'stream', description: 'Emit response events incrementally when true.' },
      { name: 'max_output_tokens', description: 'Maximum tokens allowed in the generated output.' },
    ],
    requestLabel: 'Responses request',
    request: `curl {{BASE_URL}}/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer local" \\
  -d '{
    "model": "default",
    "instructions": "Answer concisely.",
    "input": "What is a GGUF file?"
  }'`,
    responseLabel: 'Response shape',
    response: `{
  "object": "response",
  "status": "completed",
  "output": [{
    "type": "message",
    "role": "assistant",
    "content": [{"type": "output_text", "text": "GGUF is a model file format used by llama.cpp."}]
  }]
}`,
  },
  {
    id: 'structured-output',
    title: 'Structured output',
    group: 'OpenAI compatible',
    summary:
      'Constrain chat output to valid JSON or to a JSON schema so downstream code can parse predictable data.',
    endpoints: [
      { method: 'POST', path: '/v1/chat/completions', description: 'Use response_format with chat generation' },
    ],
    setup: [
      'Describe the requested JSON in the prompt as well as in response_format.',
      'Use json_object for general valid JSON or json_schema for field-level constraints.',
      'Keep schemas compact; complex grammars can increase prompt-processing and sampling cost.',
    ],
    fields: [
      { name: 'response_format.type', description: 'json_object or json_schema.', required: true },
      { name: 'response_format.schema', description: 'JSON Schema applied by llama.cpp for constrained generation.' },
      { name: 'messages', description: 'Prompt should explicitly request an object matching the schema.', required: true },
    ],
    requestLabel: 'Schema-constrained request',
    request: `curl {{BASE_URL}}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Return a person named Ada and age 36 as JSON."}],
    "response_format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": {
          "name": {"type": "string"},
          "age": {"type": "integer"}
        },
        "required": ["name", "age"]
      }
    }
  }'`,
    responseLabel: 'Assistant content',
    response: `{
  "name": "Ada",
  "age": 36
}`,
  },
  {
    id: 'tools-functions',
    title: 'Tools & functions',
    group: 'OpenAI compatible',
    summary:
      'Let a compatible chat model request application-defined functions with typed arguments. Your client executes the function and returns its result.',
    endpoints: [
      { method: 'POST', path: '/v1/chat/completions', description: 'Send tool definitions and receive tool calls' },
    ],
    setup: [
      'Enable Jinja under Reasoning & templates and use a model/template with tool-call support.',
      'The server proposes tool calls but does not execute your application functions.',
      'Append the tool result to the conversation, then call chat completions again for the final answer.',
    ],
    fields: [
      { name: 'tools', description: 'Array of function names, descriptions, and JSON Schema parameters.', required: true },
      { name: 'tool_choice', description: 'auto, none, required, or a specific function depending on template support.' },
      { name: 'parallel_tool_calls', description: 'Allow multiple tool calls in one assistant turn when supported.' },
      { name: 'messages', description: 'Conversation including assistant tool calls and tool results.', required: true },
    ],
    requestLabel: 'Function-calling request',
    request: `curl {{BASE_URL}}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "What is the weather in Denver?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"]
        }
      }
    }],
    "tool_choice": "auto"
  }'`,
    responseLabel: 'Tool-call shape',
    response: `{
  "choices": [{
    "message": {
      "role": "assistant",
      "tool_calls": [{
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\\"city\\":\\"Denver\\"}"
        }
      }]
    }
  }]
}`,
  },
  {
    id: 'embeddings',
    title: 'Embeddings',
    group: 'OpenAI compatible',
    summary:
      'Convert text into numeric vectors for semantic search, clustering, recommendations, and retrieval-augmented generation.',
    endpoints: [
      { method: 'POST', path: '/v1/embeddings', description: 'OpenAI-compatible pooled embeddings' },
      { method: 'POST', path: '/embedding', description: 'Native llama.cpp embedding shape' },
    ],
    setup: [
      'Use a dedicated embedding model and enable Embedding mode under Embedding & reranking.',
      'OpenAI-compatible embeddings require a pooling type other than none.',
      'Vector dimensions and quality depend on the model; store the model ID alongside indexed vectors.',
    ],
    fields: [
      { name: 'model', description: 'Loaded embedding model ID or alias.', required: true },
      { name: 'input', description: 'A string or array of strings to embed.', required: true },
      { name: 'encoding_format', description: 'float for a JSON array of numeric values.' },
      { name: 'dimensions', description: 'Optional reduced dimension when supported by the model/runtime.' },
    ],
    requestLabel: 'Embedding request',
    request: `curl {{BASE_URL}}/v1/embeddings \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "input": ["local language models", "semantic search"],
    "encoding_format": "float"
  }'`,
    responseLabel: 'Response shape',
    response: `{
  "object": "list",
  "data": [
    {"object": "embedding", "index": 0, "embedding": [0.012, -0.031, 0.008]},
    {"object": "embedding", "index": 1, "embedding": [0.021, -0.018, 0.004]}
  ]
}`,
  },
  {
    id: 'completions',
    title: 'Completions',
    group: 'Native llama.cpp',
    summary:
      'Send a raw prompt directly to llama.cpp and access native sampling, prompt-cache, token, and timing fields.',
    endpoints: [
      { method: 'POST', path: '/completion', description: 'Native llama.cpp completion' },
      { method: 'POST', path: '/v1/completions', description: 'OpenAI-compatible text completion' },
    ],
    setup: [
      'Use /completion when you need llama.cpp-specific options; use /v1/completions for OpenAI SDK compatibility.',
      'Set cache_prompt to reuse a stable prompt prefix between requests.',
      'A raw completion does not automatically apply chat roles unless you format the prompt yourself.',
    ],
    fields: [
      { name: 'prompt', description: 'String, token array, mixed token/string sequence, or supported multimodal object.', required: true },
      { name: 'n_predict', description: 'Maximum number of tokens generated by the native endpoint.' },
      { name: 'stream', description: 'Stream incremental native completion chunks.' },
      { name: 'cache_prompt', description: 'Reuse the matching prefix from the slot prompt cache.' },
      { name: 'stop', description: 'Array of strings that stop generation when encountered.' },
    ],
    requestLabel: 'Native completion request',
    request: `curl {{BASE_URL}}/completion \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "prompt": "Three benefits of running an LLM locally are:",
    "n_predict": 96,
    "cache_prompt": true
  }'`,
    responseLabel: 'Response shape',
    response: `{
  "content": " privacy, offline access, and direct control over model settings.",
  "stop": true,
  "stop_type": "eos",
  "tokens_cached": 0,
  "tokens_evaluated": 12,
  "timings": {
    "predicted_per_second": 31.4
  }
}`,
  },
  {
    id: 'infill',
    title: 'Infill',
    group: 'Native llama.cpp',
    summary:
      'Generate code or text between a supplied prefix and suffix using a model trained with fill-in-the-middle tokens.',
    endpoints: [
      { method: 'POST', path: '/infill', description: 'Native fill-in-the-middle generation' },
    ],
    setup: [
      'Use a code model that contains compatible FIM prefix, suffix, and middle tokens.',
      'input_extra can provide repository files as filename/text objects for broader context.',
      'The endpoint also accepts native /completion sampling options such as n_predict and temperature.',
    ],
    fields: [
      { name: 'input_prefix', description: 'Code or text immediately before the missing region.', required: true },
      { name: 'input_suffix', description: 'Code or text immediately after the missing region.', required: true },
      { name: 'input_extra', description: 'Optional array of filename/text context objects.' },
      { name: 'prompt', description: 'Optional instruction added after the FIM middle token.' },
      { name: 'n_predict', description: 'Maximum number of tokens to insert.' },
    ],
    requestLabel: 'Infill request',
    request: `curl {{BASE_URL}}/infill \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "input_prefix": "function add(a, b) {\\n  ",
    "input_suffix": "\\n}",
    "prompt": "Return the sum.",
    "n_predict": 32
  }'`,
    responseLabel: 'Response shape',
    response: `{
  "content": "return a + b;",
  "stop": true,
  "stop_type": "eos"
}`,
  },
  {
    id: 'reranking',
    title: 'Reranking',
    group: 'Native llama.cpp',
    summary:
      'Score candidate documents against a query so the most relevant passages can be selected before generation.',
    endpoints: [
      { method: 'POST', path: '/reranking', description: 'Native reranking endpoint' },
      { method: 'POST', path: '/v1/rerank', description: 'Supported reranking alias' },
    ],
    setup: [
      'Load a dedicated reranker model and enable both Embedding mode and Reranking.',
      'The runtime requires rank pooling; ordinary chat models generally cannot rerank.',
      'Use top_n to return only the strongest candidates when supported.',
    ],
    fields: [
      { name: 'query', description: 'Search question or text used to score documents.', required: true },
      { name: 'documents', description: 'Array of candidate strings.', required: true },
      { name: 'model', description: 'Loaded reranker model ID, especially in router mode.' },
      { name: 'top_n', description: 'Maximum number of ranked results to return.' },
    ],
    requestLabel: 'Reranking request',
    request: `curl {{BASE_URL}}/v1/rerank \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "default",
    "query": "How much VRAM does the model need?",
    "documents": [
      "The model download is 17 GB.",
      "KV cache size depends on context length and precision.",
      "The chat template uses Jinja."
    ],
    "top_n": 2
  }'`,
    responseLabel: 'Response shape',
    response: `{
  "results": [
    {"index": 1, "relevance_score": 0.91},
    {"index": 0, "relevance_score": 0.63}
  ]
}`,
  },
  {
    id: 'slots-metrics',
    title: 'Slots & metrics',
    group: 'Native llama.cpp',
    summary:
      'Inspect concurrent inference slots, context usage, throughput, queue depth, and Prometheus-compatible runtime counters.',
    endpoints: [
      { method: 'GET', path: '/slots', description: 'Current per-slot processing state' },
      { method: 'GET', path: '/metrics', description: 'Prometheus metrics exporter' },
      { method: 'GET', path: '/props', description: 'Model and generation properties' },
    ],
    setup: [
      'Enable Slots and Metrics under Server settings → Serving & endpoints before starting the server.',
      'Slots are enabled by default in llama.cpp but can be disabled; metrics require explicit enablement.',
      'In router mode, add ?model=<model-id> to model-specific GET requests.',
    ],
    fields: [
      { name: 'id / is_processing', description: 'Slot identity and whether it is currently handling a request.' },
      { name: 'n_ctx', description: 'Context capacity assigned to the slot.' },
      { name: 'llamacpp:requests_processing', description: 'Number of requests actively running.' },
      { name: 'llamacpp:requests_deferred', description: 'Number of requests waiting for a slot.' },
      { name: 'llamacpp:predicted_tokens_seconds', description: 'Average generation throughput in tokens per second.' },
    ],
    requestLabel: 'Monitoring requests',
    request: `curl {{BASE_URL}}/slots
curl {{BASE_URL}}/metrics
curl "{{BASE_URL}}/props?model=default"`,
    responseLabel: 'Slot response shape',
    response: `[
  {
    "id": 0,
    "is_processing": false,
    "n_ctx": 8192,
    "n_past": 0,
    "generation_settings": {
      "temperature": 0.8,
      "top_p": 0.95
    }
  }
]`,
  },
];

export const developerTopicGroups = [
  {
    label: 'Core',
    topics: developerTopics.filter((topic) => topic.group === 'Core'),
  },
  {
    label: 'OpenAI compatible',
    topics: developerTopics.filter((topic) => topic.group === 'OpenAI compatible'),
  },
  {
    label: 'Native llama.cpp',
    topics: developerTopics.filter((topic) => topic.group === 'Native llama.cpp'),
  },
];

export function findDeveloperTopic(id: string): DeveloperTopic | undefined {
  return developerTopics.find((topic) => topic.id === id);
}
