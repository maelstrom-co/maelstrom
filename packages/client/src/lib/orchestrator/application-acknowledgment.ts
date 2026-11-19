import { toError } from '@maelstrom-co/protocol';

export class ApplicationAcknowledgment {
  readonly #controller = new AbortController();
  #error: Error | null = null;

  constructor(private readonly timeoutMs: number) {}

  get error(): Error | null {
    return this.#error;
  }

  retire(error: Error): void {
    this.#error ??= error;
    this.#controller.abort(this.#error);
  }

  wait(acknowledge: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.#error) return Promise.reject(this.#error);
    const signal = this.#controller.signal;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () =>
        finish(this.#error ?? new Error('Application acknowledgment retired'));
      const timeout = setTimeout(() => {
        this.retire(
          new Error(
            'Application acknowledgment timed out; outcome is uncertain. Replace the connector before planning again.',
          ),
        );
      }, this.timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      const fail = (error: unknown) => {
        if (!done) this.retire(toError(error));
      };
      try {
        Promise.resolve(acknowledge(signal)).then(() => finish(), fail);
      } catch (error) {
        fail(error);
      }
    });
  }
}
