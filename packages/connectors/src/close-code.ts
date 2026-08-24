/**
 * Classification of WebSocket close codes for reconnect decisions.
 *
 * The `@maelstrom-co/client` WebSocket connector maps close events through
 * this taxonomy before reporting the client package's `ConnectorEvent`
 * `retryable` flag. Its connection manager consumes that flag when deciding
 * whether to reconnect. The classifier remains available from
 * `@maelstrom-co/connectors` as the shared close-code contract for other
 * WebSocket participants.
 *
 * @example
 * ```ts
 * const { clean, retryable } = classifyCloseCode(event.code);
 * // A client connector can include both values in its disconnect event.
 * ```
 */

/** How a client should treat a disconnect reported with a given close code. */
export interface CloseCodeClassification {
  /**
   * True when the code reports an intentional, orderly close (RFC 6455 1000)
   * — no auto-reconnect should fire.
   */
  readonly clean: boolean;
  /**
   * False only when retrying cannot fix the rejection (RFC 6455 1008,
   * "Policy Violation": the server is deliberately refusing this client).
   * Every other code keeps the default of retrying.
   */
  readonly retryable: boolean;
}

/**
 * Map a WebSocket close code to the reconnect semantics used by the client
 * connector.
 *
 * Only 1000 and 1008 carry meaning beyond "the transport went away". Every
 * other number classifies as unclean but retryable.
 */
export function classifyCloseCode(code: number): CloseCodeClassification {
  return {
    clean: code === 1000,
    retryable: code !== 1008,
  };
}
