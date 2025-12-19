/**
 * Abstract LLM provider interface.
 * Implement this to integrate with any LLM provider.
 */
export interface LLMProvider {
  /**
   * Send a prompt to the LLM and get a response.
   * @param prompt - The user/context prompt
   * @param systemPrompt - The system prompt
   * @returns The LLM's text response
   */
  complete(prompt: string, systemPrompt: string): Promise<string>;
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
}

/**
 * Engine error with typed error codes.
 */
export class EngineError extends Error {
  constructor(
    public readonly code: 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'LLM_ERROR' | 'TIMEOUT',
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
