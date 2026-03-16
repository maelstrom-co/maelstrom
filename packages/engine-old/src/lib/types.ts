import type {
  GridResponse,
  LayoutMode,
  TilingResponse,
} from '@maelstrom-co/protocol-old';

import type {
  AIMessage,
  HistoryConfig,
  HistoryStore,
} from './history/index.js';
import type { VoiceConfig } from './voice/types.js';

export type GridLLMResponse = GridResponse;
export type TilingLLMResponse = TilingResponse;
export type LLMResponse = GridLLMResponse | TilingLLMResponse;

/**
 * Abstract LLM provider interface.
 * Implement this to integrate with any LLM provider.
 */
export interface LLMProvider {
  /**
   * Send a prompt to the LLM and get a structured response.
   * @param prompt - The user/context prompt
   * @param systemPrompt - The system prompt
   * @param layoutMode - The layout mode to use (determines response schema)
   * @returns The structured Maelstrom response
   */
  complete(
    prompt: string,
    systemPrompt: string,
    layoutMode: LayoutMode,
  ): Promise<LLMResponse>;

  /**
   * Send a conversation with history to the LLM.
   * If not implemented, the engine will fall back to `complete()`.
   * @param messages - Conversation history as messages
   * @param currentPrompt - The current turn's prompt
   * @param systemPrompt - The system prompt
   * @param layoutMode - The layout mode to use (determines response schema)
   * @returns The structured Maelstrom response
   */
  completeWithHistory?(
    messages: AIMessage[],
    currentPrompt: string,
    systemPrompt: string,
    layoutMode: LayoutMode,
  ): Promise<LLMResponse>;
}

/**
 * Retry configuration.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 10000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
}

/**
 * Configuration for the Maelstrom engine.
 */
export interface EngineConfig {
  /** LLM provider instance */
  provider: LLMProvider;

  /** Custom system prompt (optional, uses default if not provided) */
  systemPrompt?: string;

  /** Request timeout in ms (default: 30000) */
  timeout?: number;

  /** Retry configuration for failed LLM requests */
  retry?: RetryConfig;

  /** History configuration (optional - enables history if provided) */
  history?: HistoryConfig & {
    /** The history store to use */
    store: HistoryStore;
  };

  /** Voice configuration (optional - enables voice mode if provided) */
  voice?: VoiceConfig;
}

/**
 * Engine error with typed error codes.
 */
export class EngineError extends Error {
  constructor(
    public readonly code:
      | 'PARSE_ERROR'
      | 'VALIDATION_ERROR'
      | 'LLM_ERROR'
      | 'TIMEOUT'
      | 'STT_ERROR'
      | 'TTS_ERROR'
      | 'VOICE_ERROR',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
