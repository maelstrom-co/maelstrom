import type {
  ChartRequest,
  MaelstromResponse,
  UpdateReason,
} from '@maelstrom-co/protocol';

import type {
  AIMessage,
  HistoryConfig,
  HistoryEntry,
  HistoryStore,
} from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';

/**
 * Message to inject into history without LLM processing.
 */
export interface AssistantMessage {
  sessionId: string;
  message: string;
}

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
%%%%%%% diff from: unxnxsok ec32810b "feat: migrate @maelstrom/client from mar repo" (parents of rebased revision)
\\\\\\\        to: wnwoulzu 8ddbd09f "feat: migrate @maelstrom/engine from mar repo" (rebased revision)
+   * Add an assistant message to history without a corresponding user turn.
+   * Useful for injecting programmatic messages into the conversation.
+   */
+  addAssistantMessage(input: AssistantMessage): Promise<void>;
+
+  /**
