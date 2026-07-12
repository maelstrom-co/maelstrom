import { MaelstromError } from '@maelstrom-co/protocol';

/**
 * Thrown by {@link Orchestrator.processIntent} when a request is already in
 * flight. Distinguishes "busy, retry shortly" from a genuine processing
 * failure via `instanceof` rather than matching on the error message, so
 * callers (e.g. a realtime voice session handling model-initiated barge-in)
 * can branch on it without depending on message text staying stable.
 */
export class RequestInFlightError extends MaelstromError {
  constructor() {
    super('request_in_flight', 'A request is already in flight');
    this.name = 'RequestInFlightError';
  }
}
