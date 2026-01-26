import type {
  ChartRequest,
  MaelstromResponse,
  UpdateReason,
} from '@maelstrom/protocol';
import type {
  AIMessage,
  HistoryConfig,
  HistoryEntry,
  HistoryStore,
} from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';

/**
 * Extracts the user intent string from update reasons.
 * Returns undefined if no user_intent reason exists.
 */
function extractUserIntent(updateReasons: UpdateReason[]): string | undefined {
  const intents = updateReasons
    .filter(
      (r): r is Extract<UpdateReason, { type: 'user_intent' }> =>
        r.type === 'user_intent',
    )
    .map((r) => r.intent);

  return intents.length > 0 ? intents.join(' ') : undefined;
}

/**
 * Message to inject into history without LLM processing.
 */
export interface AssistantMessageInput {
  sessionId: string;
  message: string;
}

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
   * Add an assistant message to history without a corresponding user turn.
   * Useful for injecting programmatic messages into the conversation.
   */
  addAssistantMessage(input: AssistantMessageInput): Promise<void>;

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
      const isStandaloneAssistant =
        !entry.userIntent && entry.updateReasons.length === 0;

      if (isStandaloneAssistant) {
        messages.push({
          role: 'assistant',
          content: entry.userMessage,
        });
        continue;
      }

      if (!entry.userIntent) {
        continue;
      }

      messages.push({
        role: 'user',
        content: entry.userIntent,
      });

      let assistantContent = entry.userMessage;

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
    const { updateReasons } = request.context;
    const userIntent = extractUserIntent(updateReasons);

    const base: HistoryEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sessionId: request.context.sessionId,
      timestamp: request.context.timestamp,
      updateReasons,
      userIntent,
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

    async addAssistantMessage(input: AssistantMessageInput): Promise<void> {
      const entry: HistoryEntry = {
        id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        sessionId: input.sessionId,
        timestamp: Date.now(),
        updateReasons: [],
        userMessage: input.message,
      };
      await store.addEntry(entry);
    },
  };
}
