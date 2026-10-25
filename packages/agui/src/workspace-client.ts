import { EventSchemas } from '@ag-ui/core/schemas';
import type { ApplicationSettlement } from '@maelstrom-co/client';
import type { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
import { ChartRequestMessageSchema } from '@maelstrom-co/protocol';
import {
  APPLICATION_RESULT,
  ApplicationResultSchema,
  MAX_WORKSPACE_FRAME_BYTES,
  WORKSPACE_RESULT,
  WORKSPACE_RUN,
  WorkspaceApplicationSchema,
  type WorkspaceOperation,
  type WorkspaceResult,
  WorkspaceResultSchema,
  workspaceRun,
} from './contract.js';
import { sameCorrelation } from './correlation.js';
import { WorkspaceError, type WorkspaceErrorCode } from './workspace-error.js';

type PendingRun = {
  id: string;
  started: boolean;
  resultName: string;
  value?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

/** Framework-independent run validation and application acknowledgment state. */
export class AguiWorkspaceClient {
  private send: ((data: string) => void) | undefined;
  private threadId = '';
  private sequence = 0;
  private revision = 0;
  private run: PendingRun | undefined;
  private application: WorkspaceResult | undefined;
  private stopped = false;
  private error: WorkspaceError | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;

  /** Read the first terminal protocol error, or null while usable. */
  snapshot = () => this.error;
  /** Observe terminal protocol errors; returns subscription cleanup. */
  observe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Bound every protocol run, including application acknowledgment. */
  constructor(private readonly timeoutMs = 60_000) {}

  /** Bind a live socket to its application session. */
  open(send: (data: string) => void, sessionId: SessionId) {
    if (this.run || this.application)
      this.fail(
        'connection_lost',
        'AG-UI connection changed with unfinished work.',
      );
    if (this.error) throw this.error;
    this.generation++;
    this.send = send;
    this.threadId = sessionId;
    this.sequence = 0;
    this.revision = 0;
  }

  /** Fence unresolved work without replaying it. */
  disconnect() {
    this.generation++;
    if (this.run || this.application)
      this.fail(
        'connection_lost',
        'AG-UI connection lost with unfinished work.',
      );
    this.send = undefined;
  }

  private fail(code: WorkspaceErrorCode, message: string): WorkspaceError {
    this.stopped = true;
    if (this.error === null) {
      this.error = new WorkspaceError(code, message);
      for (const listener of this.listeners) listener();
    }
    const run = this.run;
    this.run = undefined;
    if (run) {
      clearTimeout(run.timeout);
      run.reject(this.error);
    }
    return this.error;
  }

  /** Consume AG-UI output; false delegates unrelated host frames to the transport. */
  receive(raw: string, current: boolean) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return false;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('type' in value) ||
      !['RUN_STARTED', 'CUSTOM', 'RUN_FINISHED', 'RUN_ERROR'].includes(
        String(value.type),
      )
    )
      return false;
    if (!current || this.stopped) return true;
    const parsed = EventSchemas.safeParse(value);
    const run = this.run;
    if (
      !parsed.success ||
      !run ||
      new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_FRAME_BYTES
    ) {
      this.fail('invalid_run', 'Unexpected AG-UI event.');
      return true;
    }
    const event = parsed.data;
    if (event.type === 'RUN_STARTED') {
      if (
        run.started ||
        event.runId !== run.id ||
        event.threadId !== this.threadId
      ) {
        this.fail('invalid_run', 'AG-UI run correlation mismatch.');
      } else run.started = true;
    } else if (!run.started) {
      this.fail('invalid_run', 'AG-UI event arrived before its run started.');
    } else if (event.type === 'CUSTOM') {
      if (event.name !== run.resultName || run.value !== undefined)
        this.fail('invalid_run', 'Unexpected AG-UI result.');
      else if (event.name === WORKSPACE_RESULT) {
        const result = WorkspaceResultSchema.safeParse(event.value);
        if (!result.success || result.data.correlation.runId !== run.id)
          this.fail('invalid_run', 'AG-UI result correlation mismatch.');
        else run.value = result.data;
      } else run.value = event.value;
    } else if (event.type === 'RUN_FINISHED') {
      if (
        event.runId !== run.id ||
        event.threadId !== this.threadId ||
        run.value === undefined
      ) {
        this.fail('invalid_run', 'Incomplete AG-UI run.');
      } else {
        this.run = undefined;
        clearTimeout(run.timeout);
        run.resolve(run.value);
      }
    } else if (event.type === 'RUN_ERROR') {
      this.fail('run_failed', 'AG-UI workspace run stopped.');
    } else this.fail('invalid_run', 'Unsupported AG-UI workspace event.');
    return true;
  }

  private request(
    operation: WorkspaceOperation,
    resultName: string,
  ): Promise<unknown> {
    if (!this.send || this.stopped || this.run)
      return Promise.reject(new Error('AG-UI session is unavailable.'));
    const input = workspaceRun(this.threadId, operation);
    const wire = JSON.stringify({ type: WORKSPACE_RUN, input });
    if (new TextEncoder().encode(wire).byteLength > MAX_WORKSPACE_FRAME_BYTES) {
      return Promise.reject(
        this.fail(
          'request_too_large',
          'AG-UI request exceeds the workspace limit.',
        ),
      );
    }
    return new Promise((resolve, reject) => {
      this.run = {
        id: input.runId,
        started: false,
        resultName,
        resolve,
        reject,
        timeout: setTimeout(
          () => this.fail('run_timeout', 'AG-UI run timed out.'),
          this.timeoutMs,
        ),
      };
      try {
        this.send?.(wire);
      } catch {
        this.fail('send_failed', 'AG-UI send failed.');
      }
    });
  }

  /** Request a workspace response and validate its complete run before application. */
  async process(message: ChartRequestMessage) {
    const generation = this.generation;
    try {
      if (this.application || message.sessionId !== this.threadId)
        throw new Error('Unsettled AG-UI workspace.');
      const value = await this.request(
        {
          kind: 'plan',
          sequence: ++this.sequence,
          revision: this.revision,
          message: ChartRequestMessageSchema.parse(message),
        },
        WORKSPACE_RESULT,
      );
      const result = WorkspaceResultSchema.parse(value);
      if (
        generation !== this.generation ||
        this.stopped ||
        result.correlation.threadId !== this.threadId ||
        result.correlation.requestId !== message.id ||
        result.correlation.revision !== this.revision ||
        result.envelope.requestId !== message.id ||
        result.envelope.sessionId !== this.threadId ||
        result.envelope.response.requestId !== message.id
      )
        throw new Error('AG-UI workspace correlation mismatch.');
      this.application = result;
      return result.envelope.response;
    } catch (error) {
      if (generation === this.generation)
        throw this.fail('planning_failed', 'AG-UI planning stopped.');
      throw error;
    }
  }

  /** Report client-owned settlement and await correlated server acceptance. */
  async applicationSettled(settlement: ApplicationSettlement): Promise<void> {
    const generation = this.generation;
    try {
      const application = this.application;
      if (
        !application ||
        this.stopped ||
        application.correlation.requestId !== settlement.requestId
      ) {
        throw new Error('Unmatched AG-UI application settlement.');
      }
      const value = await this.request(
        {
          kind: 'applied',
          sequence: ++this.sequence,
          application: WorkspaceApplicationSchema.parse({
            correlation: application.correlation,
            status: settlement.result.status,
            actions: settlement.actions,
            chart: settlement.chart,
          }),
        },
        APPLICATION_RESULT,
      );
      const result = ApplicationResultSchema.parse(value);
      if (
        generation !== this.generation ||
        this.stopped ||
        !sameCorrelation(result.correlation, application.correlation) ||
        result.revision !== this.revision + 1 ||
        result.status !== settlement.result.status
      ) {
        throw new Error('AG-UI application acknowledgment failed.');
      }
      this.application = undefined;
      this.revision = result.revision;
      if (result.status !== 'applied')
        this.fail(
          result.status === 'failed'
            ? 'application_failed'
            : 'application_unknown',
          result.status === 'failed'
            ? 'AG-UI application failed.'
            : 'AG-UI application outcome is uncertain.',
        );
    } catch (error) {
      if (generation === this.generation)
        throw this.fail(
          'application_unknown',
          'AG-UI application outcome is uncertain.',
        );
      throw error;
    }
  }
}
