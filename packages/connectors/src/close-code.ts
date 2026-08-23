/**
 * Classification of WebSocket close codes for reconnect decisions.
 *
 * This is the shared taxonomy behind {@link ConnectorEvent}'s `retryable`
 * flag: a client connector maps a close event through this to decide what it
 * tells its connection manager, and an engine host uses the same function to
 * assert that the codes it closes with mean what the client will assume they
 * mean. Both sides importing one function is what keeps the wire semantics
 * from drifting into comments.
 *
 * @example
 * ```ts
 * // Host side: closing a socket for a reason the client must not retry.
 * const c = classifyCloseCode(1008);
 * ws.close(1008, 'policy violation'); // client classifies retryable: false
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
 * Map a WebSocket close code to the reconnect semantics both sides assume.
 *
 * Only 1000 and 1008 carry meaning beyond "the transport went away"; every
 * other code classifies as unclean but retryable, which matches how the
 * reference client's connector has always treated them.
 */
export function classifyCloseCode(code: number): CloseCodeClassification {
  return {
    clean: code === 1000,
    retryable: code !== 1008,
  };
}
