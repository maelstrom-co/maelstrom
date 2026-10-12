import type {
  ConnectionStatus,
  EnqueueIntentOptions,
  IntentSchedulerState,
  IntentSubmission,
} from '@maelstrom-co/client';
import type { MaelstromResponse, SessionId } from '@maelstrom-co/protocol';

/** Return type of m.useMaelstrom() */
export interface MaelstromState {
  /** Send a user intent to the engine. Never rejects — errors surface via lastError. */
  processIntent: (intent: string) => Promise<void>;
  /**
   * Admit immediately to the client-owned FIFO, including while busy. Operational
   * outcomes resolve on the ticket; they do not update lastError/lastResponse.
   * Observe it with useIntentSubmission. No retry is performed for unknown work.
   * A foreign options.scope throws synchronously. Unmounting this hook does not
   * cancel accepted work; use a client IntentScope for owner-lifetime retirement.
   */
  enqueueIntent: (
    intent: string,
    options?: EnqueueIntentOptions,
  ) => IntentSubmission;
  /** Shared admission state, including queued voice work and atomic application. */
  intentScheduler: IntentSchedulerState;
  /** Current connection status */
  connectionStatus: ConnectionStatus;
  /** Last connection error, if connectionStatus is 'error' */
  connectionError: Error | null;
  /** Whether a request is currently in flight */
  isProcessing: boolean;
  /** Last error from processIntent — auto-clears on next call */
  lastError: Error | null;
  /** Last successful engine response — clears when the next call starts */
  lastResponse: MaelstromResponse | null;
  /** Current session ID */
  sessionId: SessionId;
}
