import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';

/**
 * Content detail levels for history entries.
 * - minimal: Only userIntent and userMessage (smallest payload)
 * - standard: Adds rationale and execution summary (good balance)
 * - full: Includes complete request/response objects (for debugging)
 */
export type HistoryContentLevel = 'minimal' | 'standard' | 'full';

/**
 * A single conversation turn stored in history.
 */
export interface HistoryEntry {
  /** Unique entry ID */
  id: string;
  /** Session this entry belongs to */
  sessionId: string;
  /** Timestamp of the interaction */
  timestamp: number;
  /** User's intent/message */
  userIntent: string;
  /** Assistant's response message */
  userMessage: string;
  /** LLM's reasoning (standard/full levels) */
  rationale?: string;
  /** Summary of actions taken (standard/full levels) */
  executionSummary?: string;
  /** Complete request (full level only) */
  fullRequest?: ChartRequest;
  /** Complete response (full level only) */
  fullResponse?: MaelstromResponse;
}

/**
 * Configuration for history behavior.
 */
export interface HistoryConfig {
  /** What content to store per entry */
  contentLevel: HistoryContentLevel;
  /** Maximum entries to keep per session (for truncation) */
  maxEntries: number;
  /** Maximum total tokens to include in prompt (approximate) */
  maxTokens?: number;
  /** TTL for session data in milliseconds */
  sessionTtlMs?: number;
}

/**
 * Default history configuration.
 */
export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  contentLevel: 'standard',
  maxEntries: 20,
  maxTokens: 4000,
};

/**
 * Abstract storage interface - implement for different backends.
 */
export interface HistoryStore {
  /** Retrieve history entries for a session */
  getEntries(sessionId: string): Promise<HistoryEntry[]>;
  /** Add a new entry to session history */
  addEntry(entry: HistoryEntry): Promise<void>;
  /** Clear all entries for a session */
  clearSession(sessionId: string): Promise<void>;
  /** Prune expired sessions (optional) */
  pruneExpiredSessions?(): Promise<number>;
}

/**
 * AI SDK compatible message format.
 */
export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}
