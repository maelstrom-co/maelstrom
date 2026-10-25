import { EventSchemas } from '@ag-ui/core/schemas';
import type { Orchestrator } from '@maelstrom-co/client';
import type { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
import { ChartRequestMessageSchema } from '@maelstrom-co/protocol';
import { sameValue } from './agui-contract';
import {
  APPLICATION_RESULT,
  ApplicationResultSchema,
  MAX_WORKSPACE_FRAME_BYTES,
  WORKSPACE_RESULT,
  WORKSPACE_RUN,
  type WorkspaceApplication,
  WorkspaceApplicationSchema,
  type WorkspaceOperation,
  type WorkspaceResult,
  WorkspaceResultSchema,
  workspaceRun,
} from './agui-workspace-protocol';

type PendingRun = {
  id: string;
  started: boolean;
  resultName: string;
  value?: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class AguiWorkspaceClient {
  private send: ((data: string) => void) | undefined;
  private threadId = '';
  private sequence = 0;
  private revision = 0;
  private run: PendingRun | undefined;
  private application: WorkspaceResult | undefined;
  private acknowledged: Promise<void> = Promise.resolve();
  private stopped = false;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;

  snapshot = () => this.error;
  observe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  constructor(private readonly timeoutMs = 60_000) {}

  open(send: (data: string) => void, sessionId: SessionId) {
    if (this.run || this.application)
      this.fail(
        'AG-UI connection changed with unfinished work; do not replay the write.',
      );
    if (this.stopped)
      throw new Error('AG-UI session stopped; switch protocol or reload.');
    this.generation++;
    this.send = send;
    this.threadId = sessionId;
    this.sequence = 0;
    this.revision = 0;
  }

  disconnect() {
    this.generation++;
    if (this.run || this.application)
      this.fail(
        'AG-UI connection lost with unfinished work; do not replay the write.',
      );
    this.send = undefined;
  }

  private fail(message: string) {
    this.stopped = true;
    if (this.error === null) {
      this.error = message;
      for (const listener of this.listeners) listener();
    }
    const run = this.run;
    this.run = undefined;
    if (run) {
      clearTimeout(run.timeout);
      run.reject(new Error(message));
    }
  }

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
      this.fail('Unexpected AG-UI event; start a new session.');
      return true;
    }
    const event = parsed.data;
    if (event.type === 'RUN_STARTED') {
      if (
        run.started ||
        event.runId !== run.id ||
        event.threadId !== this.threadId
      ) {
        this.fail('AG-UI run correlation mismatch.');
      } else run.started = true;
    } else if (!run.started) {
      this.fail('AG-UI event arrived before its run started.');
    } else if (event.type === 'CUSTOM') {
      if (event.name !== run.resultName || run.value !== undefined)
        this.fail('Unexpected AG-UI result.');
      else if (event.name === WORKSPACE_RESULT) {
        const result = WorkspaceResultSchema.safeParse(event.value);
        if (!result.success || result.data.correlation.runId !== run.id)
          this.fail('AG-UI result correlation mismatch.');
        else run.value = result.data;
      } else run.value = event.value;
    } else if (event.type === 'RUN_FINISHED') {
      if (
        event.runId !== run.id ||
        event.threadId !== this.threadId ||
        run.value === undefined
      ) {
        this.fail('Incomplete AG-UI run.');
      } else {
        this.run = undefined;
        clearTimeout(run.timeout);
        run.resolve(run.value);
      }
    } else if (event.type === 'RUN_ERROR') {
      this.fail(
        'AG-UI workspace run stopped. Check the API key and application; switch protocol or reload to start a new session.',
      );
    } else this.fail('Unsupported AG-UI workspace event.');
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
      this.fail('AG-UI request exceeds the workspace limit.');
      return Promise.reject(
        new Error('AG-UI request exceeds the workspace limit.'),
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
          () => this.fail('AG-UI run timed out; do not replay the write.'),
          this.timeoutMs,
        ),
      };
      try {
        this.send?.(wire);
      } catch {
        this.fail('AG-UI send failed; do not replay the write.');
      }
    });
  }

  async process(message: ChartRequestMessage) {
    const generation = this.generation;
    try {
      await this.acknowledged;
      if (
        generation !== this.generation ||
        this.application ||
        message.sessionId !== this.threadId
      )
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
      if (generation === this.generation) this.fail('AG-UI planning stopped.');
      throw error;
    }
  }

  attach(orchestrator: Orchestrator) {
    let actions: WorkspaceApplication['actions'] = [];
    const matches = (requestId?: string) =>
      this.application?.correlation.requestId === requestId &&
      !!this.application;
    const acknowledge = (status: WorkspaceApplication['status']) => {
      const application = this.application;
      if (!application || this.stopped) return;
      this.application = undefined;
      const generation = this.generation;
      const operation: WorkspaceOperation = {
        kind: 'applied',
        sequence: ++this.sequence,
        application: {
          correlation: application.correlation,
          status,
          actions,
          chart: WorkspaceApplicationSchema.shape.chart.parse(
            orchestrator.getStructuralSnapshot(),
          ),
        },
      };
      actions = [];
      this.acknowledged = this.request(operation, APPLICATION_RESULT)
        .then((value) => {
          if (generation !== this.generation) return;
          const result = ApplicationResultSchema.parse(value);
          if (
            !sameValue(result.correlation, application.correlation) ||
            result.revision !== this.revision + 1 ||
            result.status !== 'applied'
          ) {
            throw new Error('AG-UI application acknowledgment failed.');
          }
          this.revision = result.revision;
        })
        .catch(() => {
          if (generation === this.generation)
            this.fail(
              'AG-UI application outcome is uncertain; do not replay the write.',
            );
        });
    };
    const releases = [
      orchestrator.commandProcessor.events.on(
        'actions_completed',
        ({ command, result }) => {
          if (matches(command.requestId))
            actions = result.actions.map((action) => ({
              instanceId: action.instanceId,
              action: action.action,
              succeeded: !action.skipped && action.result.ok,
            }));
        },
      ),
      orchestrator.commandProcessor.events.on(
        'processing_error',
        ({ command }) => {
          if (matches(command.requestId)) acknowledge('failed');
        },
      ),
      orchestrator.commandProcessor.events.on(
        'command_complete',
        ({ command }) => {
          if (
            matches(command.requestId) &&
            command.kind === 'execute_actions'
          ) {
            acknowledge(
              actions.every((action) => action.succeeded)
                ? 'applied'
                : 'failed',
            );
          }
        },
      ),
    ];
    return () => {
      for (const release of releases) release();
    };
  }
}
