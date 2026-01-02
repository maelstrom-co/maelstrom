import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';
import type {
  AIMessage,
  HistoryConfig,
  HistoryEntry,
  HistoryStore,
} from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';

/**
 * Manages conversation history for the engine.
 * Handles storage, retrieval, and conversion to AI SDK message format.
 */
export interface HistoryManager {
  /**
   * Retrieve history as AI SDK compatible messages.
   */
  getMessagesForSession(sessionId: string): Promise<AIMessage[]>;

  /**
   * Record a conversation turn.
   */
  recordTurn(request: ChartRequest, response: MaelstromResponse): Promise<void>;

  /**
   * Clear session history.
   */
  clearSession(sessionId: string): Promise<void>;

  /**
   * Get raw entries for a session (useful for debugging).
   */
  getEntries(sessionId: string): Promise<HistoryEntry[]>;
}

/**
 * Creates a new history manager.
 */
export function createHistoryManager(
  store: HistoryStore,
  config: Partial<HistoryConfig> = {},
): HistoryManager {
  const resolvedConfig: HistoryConfig = {
    ...DEFAULT_HISTORY_CONFIG,
    ...config,
  };

  function truncateEntries(entries: HistoryEntry[]): HistoryEntry[] {
    if (entries.length <= resolvedConfig.maxEntries) {
      return entries;
    }
    return entries.slice(-resolvedConfig.maxEntries);
  }

  function entriesToMessages(entries: HistoryEntry[]): AIMessage[] {
    const messages: AIMessage[] = [];

    for (const entry of entries) {
      // User turn
      messages.push({
        role: 'user',
        content: entry.userIntent,
      });

      // Assistant turn - build content based on available data
      let assistantContent = entry.userMessage;

      // Include additional context for non-minimal levels
      if (resolvedConfig.contentLevel !== 'minimal') {
        if (entry.rationale) {
          assistantContent += `\n\n[Internal reasoning: ${entry.rationale}]`;
        }
        if (entry.executionSummary) {
          assistantContent += `\n[Actions taken: ${entry.executionSummary}]`;
        }
      }

      messages.push({
        role: 'assistant',
        content: assistantContent,
      });
    }

    return messages;
  }

  function summarizeExecution(response: MaelstromResponse): string {
    if (response.executionPlan.length === 0) {
      return 'No actions taken';
    }

    const actions = response.executionPlan.map(
      (e) => `${e.instanceId}.${e.action}()`,
    );
    return actions.join(', ');
  }

  function createEntry(
    request: ChartRequest,
    response: MaelstromResponse,
  ): HistoryEntry {
    const base: HistoryEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sessionId: request.context.sessionId,
      timestamp: request.context.timestamp,
      userIntent: request.context.userIntent,
      userMessage: response.userMessage,
    };

    // Add content based on level
    if (
      resolvedConfig.contentLevel === 'standard' ||
      resolvedConfig.contentLevel === 'full'
    ) {
      base.rationale = response.rationale;
      base.executionSummary = summarizeExecution(response);
    }

    if (resolvedConfig.contentLevel === 'full') {
      base.fullRequest = request;
      base.fullResponse = response;
    }

    return base;
  }

  return {
    async getMessagesForSession(sessionId: string): Promise<AIMessage[]> {
      const entries = await store.getEntries(sessionId);

      // Apply truncation based on maxEntries
      const truncated = truncateEntries(entries);

      // Convert to AI SDK message format
      return entriesToMessages(truncated);
    },

    async recordTurn(
      request: ChartRequest,
      response: MaelstromResponse,
    ): Promise<void> {
      const entry = createEntry(request, response);
      await store.addEntry(entry);
    },

    async clearSession(sessionId: string): Promise<void> {
      await store.clearSession(sessionId);
    },

    async getEntries(sessionId: string): Promise<HistoryEntry[]> {
      return store.getEntries(sessionId);
    },
  };
}
