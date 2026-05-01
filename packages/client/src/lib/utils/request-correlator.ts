import type { MaelstromResponse, MessageId } from '@maelstrom-co/protocol';

/**
 * Request correlator for matching requests with responses.
 *
 * This utility handles the request/response correlation pattern used by
 * stateful connectors (WebSocket) to match outgoing requests with incoming
 * responses using a request ID.
 *
 * @example
 * ```typescript
 * const correlator = new RequestCorrelator<MyResponse>();
 *
 * // In process() method:
 * const promise = correlator.create(envelope.id, 30000);
 * sendToServer(envelope);
 * return promise;
 *
 * // When response arrives:
 * correlator.resolve(response.requestId, response);
 * ```
 */
export class RequestCorrelator {
  #pending = new Map<
    MessageId,
    {
      resolve: (value: MaelstromResponse) => void;
      reject: (reason: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Creates a pending request entry and returns a promise that resolves
   * when the response arrives or rejects on timeout.
   *
   * @param id - Unique request identifier
   * @param timeoutMs - Timeout in milliseconds before rejecting
   * @returns Promise that resolves with the response
   */
  create(id: MessageId, timeoutMs: number): Promise<MaelstromResponse> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.#pending.delete(id)) {
          reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.#pending.set(id, { resolve, reject, timeoutId });
    });
  }

  /**
   * Resolves a pending request with the given response.
   *
   * @param id - Request identifier to resolve
   * @param response - Response value to resolve with
   * @returns true if a pending request was found and resolved, false otherwise
   */
  resolve(id: MessageId, response: MaelstromResponse): boolean {
    const entry = this.#pending.get(id);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timeoutId);
    this.#pending.delete(id);
    entry.resolve(response);
    return true;
  }

  /**
   * Rejects a pending request with the given error.
   *
   * @param id - Request identifier to reject
   * @param error - Error to reject with
   * @returns true if a pending request was found and rejected, false otherwise
   */
  reject(id: MessageId, error: Error): boolean {
    const entry = this.#pending.get(id);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timeoutId);
    this.#pending.delete(id);
    entry.reject(error);
    return true;
  }

  /**
   * Rejects all pending requests with the given error.
   * Useful when connection is lost to clean up all pending requests.
   *
   * @param error - Error to reject all pending requests with
   */
  rejectAll(error: Error): void {
    this.#pending.forEach(({ reject, timeoutId }) => {
      clearTimeout(timeoutId);
      reject(error);
    });
    this.#pending.clear();
  }

  /**
   * Gets the number of pending requests.
   */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /**
   * Checks if a request with the given ID is pending.
   */
  has(id: MessageId): boolean {
    return this.#pending.has(id);
  }

  /**
   * Clears all pending requests without resolving or rejecting them.
   * Use with caution - this may leave promises in limbo.
   */
  clear(): void {
    this.#pending.forEach(({ timeoutId }) => {
      clearTimeout(timeoutId);
    });
    this.#pending.clear();
  }
}
