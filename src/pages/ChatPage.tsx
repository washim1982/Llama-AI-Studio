import {
  Bot,
  Box,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  FileImage,
  FolderPlus,
  Hammer,
  ImagePlus,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRight,
  Play,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type {
  AppSettings,
  Attachment,
  ChatChunk,
  ChatMessage,
  ChatSession,
  ChatSummary,
  GgufModel,
  SamplingConfig,
  ServerStatus,
} from '../types'
import {
  appendChatChunk,
  applyBufferedChunk,
  emptyBufferedChunk,
  presentMessage,
  type BufferedChatChunk,
} from '../chatStream'
import { createChat, errorMessage, getForgeApi } from '../utils'
import {
  Button,
  EmptyState,
  Field,
  IconButton,
  Notice,
  Select,
  StatusPill,
  Tag,
  TextArea,
  TextInput,
  Toggle,
} from '../components/Controls'
import { SamplingPanel } from '../components/SamplingPanel'

export function ChatPage({
  chats,
  models,
  server,
  settings,
  selectedModelId,
  onSelectModel,
  onChatsChange,
  onModelsChange,
  onSettingsChange,
  onOpenModels,
  onOpenServer,
}: {
  chats: ChatSummary[]
  models: GgufModel[]
  server: ServerStatus
  settings: AppSettings
  selectedModelId?: string
  onSelectModel: (id: string) => void
  onChatsChange: (chats: ChatSummary[]) => void
  onModelsChange: (models: GgufModel[]) => void
  onSettingsChange: (settings: AppSettings) => void
  onOpenModels: () => void
  onOpenServer: () => void
}) {
  const forgeApi = getForgeApi()
  const [activeChatId, setActiveChatId] = useState(chats[0]?.id)
  const [activeChat, setActiveChat] = useState<ChatSession>()
  const [loadingChat, setLoadingChat] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [runningRequestId, setRunningRequestId] = useState<string>()
  const runningRequestRef = useRef<string>()
  const [rightTab, setRightTab] = useState<'parameters' | 'tools'>('parameters')
  const [error, setError] = useState<string>()
  const [loadingModel, setLoadingModel] = useState(false)
  const activeChatRef = useRef<ChatSession>()
  const streamChatRef = useRef<ChatSession>()
  const bufferedChunkRef = useRef<BufferedChatChunk>(emptyBufferedChunk())
  const streamFlushTimer = useRef<ReturnType<typeof setTimeout>>()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chats.some((chat) => chat.id === activeChatId)) setActiveChatId(chats[0]?.id)
  }, [activeChatId, chats])

  useEffect(() => {
    if (!activeChatId) {
      activeChatRef.current = undefined
      setActiveChat(undefined)
      return
    }
    let disposed = false
    setLoadingChat(true)
    const api = getForgeApi()
    if (!api) {
      setLoadingChat(false)
      return
    }
    void api
      .loadChat(activeChatId)
      .then((chat) => {
        if (disposed) return
        activeChatRef.current = chat
        setActiveChat(chat)
        if (chat.modelId) onSelectModel(chat.modelId)
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        })
      })
      .catch((reason) => {
        if (!disposed) setError(errorMessage(reason))
      })
      .finally(() => {
        if (!disposed) setLoadingChat(false)
      })
    return () => {
      disposed = true
    }
  }, [activeChatId, onSelectModel])

  const availableModels = models.filter((model) => !model.validationError)
  const selectedModel = availableModels.find((model) => model.id === selectedModelId)
  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(query.toLowerCase()),
  )

  const commitChat = (nextChat: ChatSession) => {
    activeChatRef.current = nextChat
    setActiveChat(nextChat)
    const api = getForgeApi()
    if (!api) return
    void api
      .saveChat(nextChat)
      .then(({ chat, chats: summaries }) => {
        onChatsChange(summaries)
        if (activeChatRef.current === nextChat) {
          activeChatRef.current = chat
          setActiveChat(chat)
        }
      })
      .catch((reason) => setError(errorMessage(reason)))
  }

  const updateActiveChat = (
    updater: (chat: ChatSession) => ChatSession,
    persist = true,
  ) => {
    const current = activeChatRef.current
    if (!current) return
    const nextChat = updater(current)
    activeChatRef.current = nextChat
    setActiveChat(nextChat)
    if (persist) commitChat(nextChat)
  }

  useEffect(() => {
    const api = getForgeApi()
    if (!api) return
    const flush = () => {
      streamFlushTimer.current = undefined
      const target = streamChatRef.current
      const requestId = runningRequestRef.current
      const buffered = bufferedChunkRef.current
      if (!target || !requestId) return
      bufferedChunkRef.current = emptyBufferedChunk()
      const nextTarget = applyBufferedChunk(target, requestId, buffered)
      streamChatRef.current = nextTarget
      if (activeChatRef.current?.id === nextTarget.id) {
        activeChatRef.current = nextTarget
        setActiveChat(nextTarget)
      }
      if (buffered.error) setError(buffered.error)
      if (buffered.done) {
        setRunningRequestId(undefined)
        runningRequestRef.current = undefined
        const currentApi = getForgeApi()
        if (currentApi) {
          void currentApi
            .saveChat(nextTarget)
            .then(({ chat, chats: summaries }) => {
              onChatsChange(summaries)
              if (activeChatRef.current === nextTarget) {
                activeChatRef.current = chat
                setActiveChat(chat)
              }
            })
            .catch((reason) => setError(errorMessage(reason)))
        }
      }
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
    }
    const off = api.onChatChunk((chunk: ChatChunk) => {
      if (runningRequestRef.current !== chunk.requestId) return
      bufferedChunkRef.current = appendChatChunk(bufferedChunkRef.current, chunk)
      if (chunk.done) {
        if (streamFlushTimer.current) clearTimeout(streamFlushTimer.current)
        flush()
      } else if (!streamFlushTimer.current) {
        streamFlushTimer.current = setTimeout(flush, 75)
      }
    })
    return () => {
      off()
      if (streamFlushTimer.current) clearTimeout(streamFlushTimer.current)
    }
  }, [onChatsChange])

  const persistNewChat = async (chat: ChatSession) => {
    const api = getForgeApi()
    if (!api) return
    try {
      const saved = await api.saveChat(chat)
      onChatsChange(saved.chats)
      activeChatRef.current = saved.chat
      setActiveChat(saved.chat)
      setActiveChatId(saved.chat.id)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const newChat = () => {
    const chat = createChat(settings.defaultSampling)
    void persistNewChat(chat)
  }

  const newFolder = () => {
    const folder = window.prompt('Folder name')
    if (!folder?.trim()) return
    const chat = { ...createChat(settings.defaultSampling), folder: folder.trim() }
    void persistNewChat(chat)
  }

  const deleteChat = async (id: string) => {
    const api = getForgeApi()
    if (!api) return
    if (activeChatId === id && runningRequestRef.current) {
      await api.cancelChat(runningRequestRef.current)
      runningRequestRef.current = undefined
      streamChatRef.current = undefined
      bufferedChunkRef.current = emptyBufferedChunk()
      setRunningRequestId(undefined)
    }
    const next = await api.deleteChat(id)
    if (!next.length) {
      const chat = createChat(settings.defaultSampling)
      await persistNewChat(chat)
    } else {
      onChatsChange(next)
      if (activeChatId === id) setActiveChatId(next[0].id)
    }
  }

  const addImages = async () => {
    const api = getForgeApi()
    if (!api) return
    const files = await api.chooseImages()
    setAttachments((current) => [...current, ...files])
  }

  const sendMessage = async () => {
    const api = getForgeApi()
    if (!draft.trim() || !activeChat || !selectedModel || runningRequestId || !api) return
    setError(undefined)
    if (attachments.length && !selectedModel.mmprojPath) {
      setError('Pair this text model with its matching mmproj.gguf in My Models before sending images.')
      return
    }
    try {
      const demandMode = settings.defaultLoadConfig.onDemandLoading
      if (
        server.state !== 'running' ||
        (!demandMode && server.modelId !== selectedModel.id) ||
        (demandMode && server.mode !== 'on-demand')
      ) {
        setLoadingModel(true)
        await api.startServer(selectedModel.id, {
          ...settings.defaultLoadConfig,
          mmprojPath:
            selectedModel.mmprojPath || settings.defaultLoadConfig.mmprojPath || '',
        })
      }
      const requestId = crypto.randomUUID()
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: draft.trim(),
        attachments,
        createdAt: Date.now(),
      }
      const assistantMessage: ChatMessage = {
        id: requestId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      }
      const firstMessage = activeChat.messages.length === 0
      const nextChat: ChatSession = {
        ...activeChat,
        modelId: selectedModel.id,
        title: firstMessage ? draft.trim().slice(0, 52) : activeChat.title,
        messages: [...activeChat.messages, userMessage, assistantMessage],
        updatedAt: Date.now(),
      }
      commitChat(nextChat)
      streamChatRef.current = nextChat
      bufferedChunkRef.current = emptyBufferedChunk()
      setDraft('')
      setAttachments([])
      setRunningRequestId(requestId)
      runningRequestRef.current = requestId
      await api.chat({
        requestId,
        model: selectedModel.apiId,
        messages: nextChat.messages.filter((message) => message.id !== requestId),
        systemPrompt: nextChat.systemPrompt,
        sampling: nextChat.sampling,
      })
    } catch (reason) {
      setError(errorMessage(reason))
      setRunningRequestId(undefined)
    } finally {
      setLoadingModel(false)
    }
  }

  const cancel = async () => {
    const api = getForgeApi()
    if (runningRequestId && api) await api.cancelChat(runningRequestId)
  }

  const applyPreset = (presetId: string) => {
    const preset = settings.presets.find((item) => item.id === presetId)
    if (!preset) return
    updateActiveChat((chat) => ({
      ...chat,
      systemPrompt: preset.systemPrompt,
      sampling: { ...preset.sampling, stop: [...preset.sampling.stop] },
      updatedAt: Date.now(),
    }))
  }

  const savePreset = async () => {
    const api = getForgeApi()
    if (!activeChat || !api) return
    const name = window.prompt('Preset name', activeChat.title)
    if (!name?.trim()) return
    const next = {
      ...settings,
      presets: [
        ...settings.presets,
        {
          id: crypto.randomUUID(),
          name: name.trim(),
          systemPrompt: activeChat.systemPrompt,
          sampling: structuredClone(activeChat.sampling),
        },
      ],
    }
    onSettingsChange(await api.saveSettings(next))
  }

  return (
    <div className="chat-workspace">
      <aside className="chat-sidebar">
        <div className="pane-header">
          <div>
            <strong>Chats</strong>
            <span>{chats.length} local</span>
          </div>
          <IconButton label="New chat" onClick={newChat}>
            <MessageSquarePlus size={17} />
          </IconButton>
        </div>
        <div className="sidebar-search">
          <TextInput
            prefix={<Search size={14} />}
            placeholder="Search chats"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button className="folder-button" onClick={newFolder}>
          <FolderPlus size={15} />
          New folder
        </button>
        <div className="chat-list">
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              className={`chat-list-item ${chat.id === activeChatId ? 'active' : ''}`}
              onClick={() => setActiveChatId(chat.id)}
            >
              <span>
                <strong>{chat.title}</strong>
                <small>
                  {chat.folder ? `${chat.folder} · ` : ''}
                  {chat.messageCount} messages
                </small>
              </span>
              <IconButton
                label="Delete chat"
                onClick={(event) => {
                  event.stopPropagation()
                  void deleteChat(chat.id)
                }}
              >
                <Trash2 size={13} />
              </IconButton>
            </button>
          ))}
        </div>
      </aside>

      <section className="conversation-pane">
        <header className="model-bar">
          <div className="model-select-wrap">
            <Bot size={15} />
            <Select
              value={selectedModelId ?? ''}
              onChange={(event) => onSelectModel(event.target.value)}
            >
              <option value="" disabled>
                Select a GGUF model
              </option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.quantization}
                </option>
              ))}
            </Select>
          </div>
          <div className="model-bar-actions">
            {server.state === 'running' &&
            server.mode === 'on-demand' &&
            server.modelId === selectedModelId ? (
              <StatusPill
                status={
                  server.residency === 'loaded'
                    ? 'success'
                    : server.residency === 'loading'
                      ? 'warning'
                      : 'info'
                }
              >
                GPU {server.residency ?? 'managed'}
              </StatusPill>
            ) : server.state === 'running' && server.mode === 'on-demand' ? (
              <StatusPill status="info">On-demand ready</StatusPill>
            ) : server.state === 'running' && server.modelId === selectedModelId ? (
              <StatusPill status="success">Loaded</StatusPill>
            ) : server.state === 'starting' ? (
              <StatusPill status="warning">Loading</StatusPill>
            ) : (
              <StatusPill status="neutral">Not loaded</StatusPill>
            )}
            <IconButton label="Developer server" onClick={onOpenServer}>
              <PanelRight size={16} />
            </IconButton>
            <IconButton label="More options">
              <MoreHorizontal size={17} />
            </IconButton>
          </div>
        </header>
        <div className="messages" ref={scrollRef}>
          {loadingChat ? (
            <EmptyState
              icon={<Sparkles className="spin" size={25} />}
              title="Opening conversation"
              description="Loading messages from local storage."
            />
          ) : !activeChat?.messages.length ? (
            <EmptyState
              icon={<Sparkles size={25} />}
              title="Start a local conversation"
              description={
                selectedModel
                  ? `Chat privately with ${selectedModel.name}. The model and prompts stay on this computer.`
                  : models.length
                    ? 'No loadable GGUF is available. Finish incomplete downloads or repair corrupt files in My models.'
                    : 'Import a GGUF model, then select it from the model bar.'
              }
              action={
                !availableModels.length ? (
                  <Button variant="primary" onClick={onOpenModels}>
                    <Box size={15} />
                    {models.length ? 'Review model problems' : 'Add a GGUF model'}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            activeChat.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={message.id === runningRequestId}
              />
            ))
          )}
        </div>
        <div className="composer-area">
          {error && (
            <Notice kind="danger" onClose={() => setError(undefined)}>
              {error}
            </Notice>
          )}
          {!!attachments.length && (
            <div className="attachment-strip">
              {attachments.map((attachment) => (
                <div className="attachment-chip" key={attachment.id}>
                  <img src={attachmentUrl(attachment)} alt="" />
                  <span>{attachment.name}</span>
                  <IconButton
                    label="Remove image"
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                  >
                    <X size={12} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
          <div className="composer">
            <TextArea
              rows={2}
              value={draft}
              placeholder={
                selectedModel
                  ? 'Send a message to the model…'
                  : 'Select or import a GGUF model first…'
              }
              disabled={!selectedModel}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
            />
            <div className="composer-toolbar">
              <div>
                <IconButton
                  label="Attach images"
                  onClick={() => void addImages()}
                  disabled={!selectedModel?.mmprojPath}
                >
                  <ImagePlus size={17} />
                </IconButton>
                <IconButton label="Tools" onClick={() => setRightTab('tools')}>
                  <Hammer size={16} />
                </IconButton>
              </div>
              {runningRequestId ? (
                <IconButton label="Stop generation" className="send-button" onClick={cancel}>
                  <CircleStop size={17} />
                </IconButton>
              ) : (
                <IconButton
                  label="Send"
                  className="send-button"
                  onClick={() => void sendMessage()}
                  disabled={!draft.trim() || !selectedModel || loadingModel}
                >
                  {loadingModel ? <ChevronDown className="spin" size={17} /> : <SendHorizontal size={17} />}
                </IconButton>
              )}
            </div>
          </div>
          <span className="composer-hint">
            Enter to send · Shift+Enter for a new line · local inference
          </span>
        </div>
      </section>

      <aside className="right-inspector">
        <div className="inspector-tabs">
          <button
            className={rightTab === 'parameters' ? 'active' : ''}
            onClick={() => setRightTab('parameters')}
            title="Model parameters"
          >
            <SlidersIcon />
          </button>
          <button
            className={rightTab === 'tools' ? 'active' : ''}
            onClick={() => setRightTab('tools')}
            title="Tools"
          >
            <Wrench size={16} />
          </button>
        </div>
        {rightTab === 'parameters' && activeChat && (
          <div className="inspector-scroll">
            <div className="inspector-title">
              <strong>Model parameters</strong>
              <span>Applied to this conversation</span>
            </div>
            <Field label="Preset">
              <Select defaultValue="" onChange={(event) => applyPreset(event.target.value)}>
                <option value="" disabled>
                  Select a preset…
                </option>
                {settings.presets.map((preset) => (
                  <option value={preset.id} key={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={() => void savePreset()}>Save current as preset</Button>
            <div className="inspector-block">
              <Field label="System prompt">
                <TextArea
                  rows={5}
                  value={activeChat.systemPrompt}
                  placeholder='Example: "Only answer in rhymes."'
                  onChange={(event) =>
                    updateActiveChat((chat) => ({
                      ...chat,
                      systemPrompt: event.target.value,
                      updatedAt: Date.now(),
                    }))
                  }
                />
              </Field>
            </div>
            <SamplingPanel
              value={activeChat.sampling}
              onChange={(sampling: SamplingConfig) =>
                updateActiveChat((chat) => ({
                  ...chat,
                  sampling,
                  updatedAt: Date.now(),
                }))
              }
            />
          </div>
        )}
        {rightTab === 'tools' && (
          <ToolsInspector settings={settings} server={server} />
        )}
      </aside>
    </div>
  )
}

function attachmentUrl(attachment: Attachment): string {
  if (attachment.dataUrl) return attachment.dataUrl
  const fileName = attachment.path?.split(/[\\/]/).pop()
  return fileName ? `forge-file://attachment/${encodeURIComponent(fileName)}` : ''
}

function CodeBlock({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const match = /language-(\w+)/.exec(className || '')
  const language = match ? match[1] : 'text'
  const [copied, setCopied] = useState(false)
  const codeString = String(children).replace(/\n$/, '')

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button type="button" className="code-block-copy-btn" onClick={handleCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '14px 16px',
          background: 'transparent',
          fontSize: '13px',
          lineHeight: '1.6',
          borderRadius: 0,
        }}
        codeTagProps={{
          style: {
            background: 'transparent',
            backgroundColor: 'transparent',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          },
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  )
}

function MessageBubble({
  message,
  isStreaming,
}: {
  message: ChatMessage
  isStreaming: boolean
}) {
  const [showReasoning, setShowReasoning] = useState(false)
  const presentation = presentMessage(message, isStreaming)
  if (message.role === 'assistant' && !message.content && !message.reasoning) {
    return (
      <div className="message-row assistant">
        <div className="message-avatar">
          <Bot size={15} />
        </div>
        <div className="thinking-dots">
          <span />
          <span />
          <span />
        </div>
      </div>
    )
  }
  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-avatar">
        {message.role === 'assistant' ? <Bot size={15} /> : <span>Y</span>}
      </div>
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === 'assistant' ? 'Assistant' : 'You'}</strong>
          <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {!!message.attachments?.length && (
          <div className="message-images">
            {message.attachments.map((attachment) => (
              <img
                src={attachmentUrl(attachment)}
                alt={attachment.name}
                key={attachment.id}
              />
            ))}
          </div>
        )}
        {presentation.reasoning && (
          <div className="reasoning-block">
            <button type="button" onClick={() => setShowReasoning((value) => !value)}>
              <BrainCircuit size={14} />
              {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
              <ChevronDown size={13} />
            </button>
            {showReasoning && <pre>{presentation.reasoning}</pre>}
          </div>
        )}
        {presentation.reasoningOnlyFallback && (
          <div className="reasoning-fallback-note">
            This model returned generated text only in its reasoning channel. Showing
            it as the response so the output is not hidden. For future replies, choose
            Response controls → Reasoning output → Direct answer.
          </div>
        )}
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, inline, className, children, ...props }: any) {
                const match = /language-(\w+)/.exec(className || '')
                const codeStr = String(children).replace(/\n$/, '')
                const isMultiLine = codeStr.includes('\n')

                if (inline || (!match && !isMultiLine)) {
                  return (
                    <code className="inline-code" {...props}>
                      {children}
                    </code>
                  )
                }
                return <CodeBlock className={className}>{children}</CodeBlock>
              },
              pre({ children }: any) {
                return <>{children}</>
              },
            }}
          >
            {presentation.content}
          </ReactMarkdown>
        </div>
        {!!message.toolCalls?.length && (
          <div className="tool-calls">
            {message.toolCalls.map((call) => (
              <div key={call.id}>
                <Wrench size={13} />
                <strong>{call.name || 'Tool call'}</strong>
                <code>{call.arguments}</code>
              </div>
            ))}
          </div>
        )}
        {message.role === 'assistant' && presentation.content && (
          <div className="message-actions">
            <IconButton
              label="Copy response"
              onClick={() => navigator.clipboard.writeText(presentation.content)}
            >
              <Copy size={13} />
            </IconButton>
            {message.tokens && <span>{message.tokens} tokens</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolsInspector({
  settings,
  server,
}: {
  settings: AppSettings
  server: ServerStatus
}) {
  const tools = settings.defaultLoadConfig.tools
  return (
    <div className="inspector-scroll">
      <div className="inspector-title">
        <strong>Integrations & tools</strong>
        <span>llama.cpp native agent capabilities</span>
      </div>
      <Notice kind="warning">
        File-writing and shell tools can change this computer. They are off by default.
      </Notice>
      {[
        ['read_file', 'Read files', 'Let the model inspect a chosen workspace.'],
        ['file_glob_search', 'Find files', 'Search paths by file name.'],
        ['grep_search', 'Search contents', 'Search text inside local files.'],
        ['get_datetime', 'Date and time', 'Read the current local date and time.'],
        ['write_file', 'Write files', 'Create or replace local files.'],
        ['edit_file', 'Edit files', 'Apply targeted changes to files.'],
        ['exec_shell_command', 'Shell commands', 'Execute commands on this computer.'],
      ].map(([id, name, description]) => (
        <div className="integration-row" key={id}>
          <span className="integration-icon">
            <Wrench size={15} />
          </span>
          <span>
            <strong>{name}</strong>
            <small>{description}</small>
          </span>
          <Toggle label={name} checked={tools.includes(id)} onChange={() => undefined} disabled />
        </div>
      ))}
      <div className="inspector-footer-note">
        <Tag color={server.state === 'running' ? 'green' : 'neutral'}>
          {server.state === 'running' ? 'Server running' : 'Server stopped'}
        </Tag>
        Change enabled tools in the model load or developer settings, then restart the server.
      </div>
    </div>
  )
}

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  )
}
