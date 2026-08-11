import type { ConnectionStatus } from '@maelstrom-co/client';
import type { MaelstromResponse, SessionId } from '@maelstrom-co/protocol';

/** Return type of m.useMaelstrom() */
export interface MaelstromState {
  /** Send a user intent to the engine. Never rejects — errors surface via lastError. */
  processIntent: (intent: string) => Promise<void>;
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
