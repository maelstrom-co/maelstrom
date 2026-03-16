import type {
  ChartRequest,
  MaelstromResponse,
} from '@maelstrom-co/protocol-old';

import type { AssistantMessage } from './history/history-manager.js';
import { createHistoryManager } from './history/index.js';
import { buildPrompt } from './prompt-builder.js';
import { buildResponse } from './response-parser.js';
import type { EngineConfig, LLMResponse, RetryConfig } from './types.js';
import { EngineError } from './types.js';

export type { AssistantMessage } from './history/history-manager.js';

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
    systemPrompt: customSystemPrompt,
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

  const historyManager = historyConfig
    ? createHistoryManager(historyConfig.store, {
        contentLevel: historyConfig.contentLevel,
        maxEntries: historyConfig.maxEntries,
        ...(historyConfig.maxTokens !== undefined && {
          maxTokens: historyConfig.maxTokens,
        }),
        ...(historyConfig.sessionTtlMs !== undefined && {
          sessionTtlMs: historyConfig.sessionTtlMs,
        }),
      })
    : null;

  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      const { prompt, systemPrompt } = buildPrompt(request, customSystemPrompt);
      const layoutMode = request.context.layoutMode;

      let llmResponse: LLMResponse;

      const completeWithHistory = provider.completeWithHistory;
      if (historyManager && completeWithHistory) {
        const sessionId = request.context.sessionId;
        const historyMessages =
          await historyManager.getMessagesForSession(sessionId);

        llmResponse = await retryWithBackoff(
          () =>
            withTimeout(
              completeWithHistory(
                historyMessages,
                prompt,
                systemPrompt,
                layoutMode,
              ),
              timeout,
            ),
          retryConfig,
        );
      } else {
        llmResponse = await retryWithBackoff(
          () =>
            withTimeout(
              provider.complete(prompt, systemPrompt, layoutMode),
              timeout,
            ),
          retryConfig,
        );
      }

      const response = buildResponse(llmResponse, request);

      if (historyManager) {
        await historyManager.recordTurn(request, response);
      }

      return response;
    },

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

      if (attempt === config.maxAttempts) {
        break;
      }

      await sleep(delay);

      delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  throw new EngineError(
    'LLM_ERROR',
    `Failed after ${config.maxAttempts} attempts: ${lastError?.message}`,
    { cause: lastError },
  );
}

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
