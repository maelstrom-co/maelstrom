import { MaelstromError } from '@maelstrom-co/protocol';

/**
 * Thrown by {@link Orchestrator.processIntent} when a concurrent
 * {@link Orchestrator.setConnector} superseded the request while it was in
 * flight.
 *
 * The response the outgoing connector produced is deliberately never
 * dispatched, so resolving with it would hand the caller a `userMessage`
 * describing a board that never moved — a realtime voice session would speak
 * it aloud while the UI sat still. Rejecting instead makes the discard
 * observable: `useMaelstrom` surfaces it through `lastError` / `onError`, and
 * callers `instanceof`-match it to re-issue the intent against the new
 * connector rather than treating it as a processing failure.
 */
export class ConnectorSupersededError extends MaelstromError {
  constructor() {
    super(
      'connector_superseded',
      'The connector was replaced while the request was in flight',
    );
    this.name = 'ConnectorSupersededError';
  }
}
