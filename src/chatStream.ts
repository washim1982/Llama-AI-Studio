import type { ChatChunk, ChatMessage, ChatSession, ToolCall } from './types';

export interface BufferedChatChunk {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  completionTokens?: number;
  done: boolean;
  error?: string;
}

export const emptyBufferedChunk = (): BufferedChatChunk => ({
  content: '',
  reasoning: '',
  toolCalls: [],
  done: false,
});

export function appendChatChunk(
  current: BufferedChatChunk,
  chunk: ChatChunk,
): BufferedChatChunk {
  return {
    content: `${current.content}${chunk.content ?? ''}`,
    reasoning: `${current.reasoning}${chunk.reasoning ?? ''}`,
    toolCalls: mergeToolCalls(current.toolCalls, chunk.toolCalls ?? []),
    completionTokens: chunk.completionTokens ?? current.completionTokens,
    done: current.done || Boolean(chunk.done),
    error: chunk.error ?? current.error,
  };
}

export function applyBufferedChunk(
  chat: ChatSession,
  requestId: string,
  chunk: BufferedChatChunk,
): ChatSession {
  return {
    ...chat,
    updatedAt: Date.now(),
    messages: chat.messages.map((message) =>
      message.id === requestId ? mergeMessage(message, chunk) : message,
    ),
  };
}

export interface MessagePresentation {
  content: string;
  reasoning?: string;
  reasoningOnlyFallback: boolean;
}

export function presentMessage(
  message: ChatMessage,
  isStreaming: boolean,
): MessagePresentation {
  const reasoningOnlyFallback =
    message.role === 'assistant' &&
    !isStreaming &&
    !message.content.trim() &&
    Boolean(message.reasoning?.trim());
  return {
    content: reasoningOnlyFallback ? message.reasoning ?? '' : message.content,
    reasoning: reasoningOnlyFallback ? undefined : message.reasoning,
    reasoningOnlyFallback,
  };
}

function mergeMessage(
  message: ChatMessage,
  chunk: BufferedChatChunk,
): ChatMessage {
  return {
    ...message,
    content: `${message.content}${chunk.content}`,
    reasoning: `${message.reasoning ?? ''}${chunk.reasoning}` || undefined,
    toolCalls: mergeToolCalls(message.toolCalls ?? [], chunk.toolCalls),
    tokens: chunk.completionTokens ?? message.tokens,
  };
}

function mergeToolCalls(current: ToolCall[], incoming: ToolCall[]): ToolCall[] {
  const merged = current.map((call) => ({ ...call }));
  for (const call of incoming) {
    const existing = merged.find((item) => item.id === call.id);
    if (existing) {
      existing.name += call.name;
      existing.arguments += call.arguments;
    } else {
      merged.push({ ...call });
    }
  }
  return merged;
}
