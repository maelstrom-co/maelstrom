import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';
import { createHistoryManager } from './history/index.js';
import { buildPrompt, DEFAULT_SYSTEM_PROMPT } from './prompt-builder.js';
import { parseResponse } from './response-parser.js';
import type { EngineConfig, RetryConfig } from './types.js';
import { EngineError } from './types.js';

/**
 * Message to inject into history without LLM processing.
 */
export interface AssistantMessage {
  sessionId: string;
  message: string;
}

/**
 * The Maelstrom decision engine.
 */
export interface Engine {
  /**
   * Process a chart request and return decisions.
   */
  process(request: ChartRequest): Promise<MaelstromResponse>;

  /**
   * Clear history for a session (if history is enabled).
   */
  clearSessionHistory?(sessionId: string): Promise<void>;

  /**
   * Add an assistant message to history without LLM processing.
   * Useful for injecting programmatic messages into the conversation.
   * Only available when history is enabled.
   */
  addAssistantMessage?(message: AssistantMessage): Promise<void>;
}

/**
 * Creates a new Maelstrom engine.
 */
export function createEngine(config: EngineConfig): Engine {
  const {
    provider,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    timeout = 30000,
    retry = {},
    history: historyConfig,
  } = config;

  const retryConfig: Required<RetryConfig> = {
    maxAttempts: retry.maxAttempts ?? 3,
    initialDelayMs: retry.initialDelayMs ?? 1000,
    maxDelayMs: retry.maxDelayMs ?? 10000,
    backoffMultiplier: retry.backoffMultiplier ?? 2,
  };

  // Create history manager if configured
  const historyManager = historyConfig
    ? createHistoryManager(historyConfig.store, {
        contentLevel: historyConfig.contentLevel,
        maxEntries: historyConfig.maxEntries,
        maxTokens: historyConfig.maxTokens,
        sessionTtlMs: historyConfig.sessionTtlMs,
      })
    : null;

  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      // Build the prompt from the request
      const prompt = buildPrompt(request);

      let llmResponse: string;

      // Use history-aware completion if available and configured
      const completeWithHistory = provider.completeWithHistory;
      if (historyManager && completeWithHistory) {
        const sessionId = request.context.sessionId;
        const historyMessages =
          await historyManager.getMessagesForSession(sessionId);

        llmResponse = await retryWithBackoff(
          () =>
            withTimeout(
              completeWithHistory(historyMessages, prompt, systemPrompt),
              timeout,
            ),
          retryConfig,
        );
      } else {
        // Fallback to simple completion
        llmResponse = await retryWithBackoff(
          () => withTimeout(provider.complete(prompt, systemPrompt), timeout),
          retryConfig,
        );
      }

      // Parse the response
      const response = parseResponse(llmResponse, request);

      // Record to history if enabled
      if (historyManager) {
        await historyManager.recordTurn(request, response);
      }

      return response;
    },

    // Expose history clearing if history is enabled
    ...(historyManager && {
      async clearSessionHistory(sessionId: string): Promise<void> {
        await historyManager.clearSession(sessionId);
      },
      async addAssistantMessage(message: AssistantMessage): Promise<void> {
        await historyManager.addAssistantMessage(message);
      },
    }),
  };
}

/**
 * Retries a function with exponential backoff.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>,
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on parse errors (LLM gave bad response, retrying won't help)
      if (error instanceof EngineError && error.code === 'PARSE_ERROR') {
        throw error;
      }

      // Don't retry on validation errors
      if (error instanceof EngineError && error.code === 'VALIDATION_ERROR') {
        throw error;
      }

      // Last attempt, throw the error
      if (attempt === config.maxAttempts) {
        break;
      }

      // Wait before retrying
      await sleep(delay);

      // Increase delay for next attempt
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  throw new EngineError(
    'LLM_ERROR',
    `Failed after ${config.maxAttempts} attempts: ${lastError?.message}`,
    { cause: lastError },
  );
}

/**
 * Wraps a promise with a timeout.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new EngineError('TIMEOUT', `Request timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
