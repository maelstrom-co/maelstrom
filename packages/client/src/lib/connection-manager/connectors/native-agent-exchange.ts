import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentInputMessage,
  AgentInputSchema,
  type AgentUiChangeEvent,
  type ChartRequestMessage,
  type MaelstromResponse,
  type MessageId,
  type RunId,
  toError,
} from '@maelstrom-co/protocol';

import type { ApplicationSettlement } from '../application-settlement.js';
import { WireEngineError } from '../connector.types.js';

type Pending = {
  message: ChartRequestMessage;
  response: ReturnType<typeof deferred<MaelstromResponse>>;
  terminal: ReturnType<typeof deferred<void>>;
  timer: ReturnType<typeof setTimeout>;
  runId?: RunId;
  change?: AgentUiChangeEvent;
  status?: ApplicationSettlement['result']['status'];
  acknowledgmentId?: MessageId;
  releaseAbort?: () => void;
};

// Unknown terminal codes cannot prove that the server stopped before application.
const planningFailures = new Set([
  'internal_error',
  'ParseError',
  'ProviderError',
  'ValidationError',
  'TimeoutError',
  'HistoryError',
  'RequestValidationError',
]);

// Orchestrator owns admission. This exchange holds only the correlation and
// acknowledgment for its one active request; it never queues or replays work.
export class NativeAgentExchange {
  #pending?: Pending;
  #stopped?: Error;

  constructor(
    private readonly timeout: number,
    private readonly send: (message: AgentInputMessage) => void,
  ) {}

  assertAvailable(): void {
    if (this.#stopped) throw this.#stopped;
  }

  interrupt(error: Error): void {
    if (this.#pending) this.stop(error);
  }

  wireError(requestId: MessageId | undefined, error: Error): void {
    const pending = this.#pending;
    if (
      pending &&
      (requestId === undefined ||
        requestId === pending.message.id ||
        requestId === pending.acknowledgmentId)
    )
      this.stop(error);
  }

  stop(error: Error): void {
    this.#stopped ??= error;
    const pending = this.#pending;
    if (!pending) return;
    this.#clear(pending);
    pending.response.reject(this.#stopped);
    pending.terminal.reject(this.#stopped);
  }

  process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    this.assertAvailable();
    if (this.#pending) throw new Error('Native agent request already active');
    const pending: Pending = {
      message,
      response: deferred<MaelstromResponse>(),
      terminal: deferred<void>(),
      timer: setTimeout(
        () => this.stop(new Error('Native agent planning timed out')),
        this.timeout,
      ),
    };
    // A terminal may arrive while Actions still run, before the hook can await it.
    void pending.terminal.promise.catch(() => {});
    this.#pending = pending;
    try {
      this.send(
        AgentInputMessage({
          sessionId: message.sessionId,
          id: message.id,
          input: AgentInputSchema.parse({
            type: 'chart_request',
            version: AGENT_WIRE_VERSION,
            inputId: message.id,
            request: message.request,
          }),
        }),
      );
    } catch (error) {
      this.stop(toError(error));
    }
    return pending.response.promise.then((response) => {
      this.assertAvailable();
      return response;
    });
  }

  async settle(
    settlement: ApplicationSettlement,
    signal?: AbortSignal,
  ): Promise<void> {
    this.assertAvailable();
    const pending = this.#pending;
    if (
      !pending?.change ||
      pending.message.id !== settlement.requestId ||
      pending.status
    ) {
      const error = new Error(
        'Native agent settlement does not match the active UI change',
      );
      this.stop(error);
      throw error;
    }
    try {
      const { chartRequest, result, actions } = settlement;
      const plan = pending.change.response.executionPlan;
      if (
        !chartRequest ||
        actions.length > plan.length ||
        (result.status === 'applied' && actions.length !== plan.length) ||
        actions.some(
          (action, index) =>
            action.instanceId !== plan[index].instanceId ||
            action.action !== plan[index].action,
        )
      )
        throw new Error(
          'Native agent settlement requires a full Chart and ordered Action evidence',
        );
      const abort = () =>
        this.stop(
          new Error(
            'Native agent acknowledgment cancelled; outcome is uncertain',
          ),
        );
      if (signal?.aborted) {
        abort();
        return await pending.terminal.promise;
      }
      signal?.addEventListener('abort', abort, { once: true });
      pending.releaseAbort = () => signal?.removeEventListener('abort', abort);
      pending.status = result.status;
      const acknowledgment = AgentInputMessage({
        sessionId: pending.message.sessionId,
        input: AgentInputSchema.parse({
          type: 'ui_applied',
          version: AGENT_WIRE_VERSION,
          changeId: pending.change.changeId,
          status: result.status,
          chart: chartRequest,
          actionOutcomes: actions.map((action) => ({ ok: action.succeeded })),
        }),
      });
      pending.acknowledgmentId = acknowledgment.id;
      this.send(acknowledgment);
    } catch (error) {
      this.stop(toError(error));
    }
    return pending.terminal.promise;
  }

  receive(event: AgentEvent): void {
    if (this.#stopped) return;
    const pending = this.#pending;
    // Finished runs own no admission. Late duplicates cannot apply a UI change.
    if (!pending) return;
    const invalid = () =>
      this.stop(new Error(`Unexpected native agent ${event.type} event`));
    switch (event.type) {
      case 'placeholder':
        if (event.inputId !== pending.message.id) invalid();
        return;
      case 'accepted':
        if (
          event.inputId !== pending.message.id ||
          event.disposition !== 'ui_only' ||
          !event.runId ||
          (pending.runId && pending.runId !== event.runId)
        ) {
          invalid();
          return;
        }
        pending.runId = event.runId;
        return;
      case 'ui_change':
        if (
          !pending.runId ||
          event.runId !== pending.runId ||
          event.response.requestId !== pending.message.id
        ) {
          invalid();
          return;
        }
        if (pending.change) {
          if (JSON.stringify(event) !== JSON.stringify(pending.change))
            invalid();
          return;
        }
        pending.change = structuredClone(event);
        clearTimeout(pending.timer);
        // This budget includes application, as does the server's acknowledgment budget.
        pending.timer = setTimeout(
          () =>
            this.stop(
              new Error(
                'Native agent application acknowledgment timed out; outcome is uncertain',
              ),
            ),
          this.timeout,
        );
        pending.response.resolve(event.response);
        return;
      case 'finished':
        if (event.runId !== pending.runId) {
          invalid();
          return;
        }
        if (
          !pending.change &&
          event.reason === 'error' &&
          event.code &&
          planningFailures.has(event.code)
        ) {
          this.#clear(pending);
          pending.response.reject(
            new WireEngineError(
              event.error ?? 'Native agent planning failed',
              event.code,
            ),
          );
          pending.terminal.resolve();
          return;
        }
        if (
          (pending.status === 'applied' && event.reason === 'completed') ||
          (pending.status === 'failed' &&
            event.reason === 'error' &&
            event.code === 'ui_apply_failed')
        ) {
          this.#clear(pending);
          pending.terminal.resolve();
        } else
          this.stop(
            new WireEngineError(
              event.error ?? 'Native agent application outcome is uncertain',
              event.code,
            ),
          );
        return;
      case 'error':
        this.stop(new WireEngineError(event.error, event.code));
        return;
      case 'message':
        if (event.runId !== pending.runId) invalid();
        return;
    }
  }

  #clear(pending: Pending): void {
    clearTimeout(pending.timer);
    pending.releaseAbort?.();
    this.#pending = undefined;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
