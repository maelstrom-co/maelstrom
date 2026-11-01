import {
  APPLICATION_RESULT,
  actionDigest,
  sameCorrelation,
  WORKSPACE_RESULT,
  type WorkspaceCheckpoint,
  WorkspaceCheckpointSchema,
  type WorkspaceRun,
} from '@maelstrom-co/agui-protocol';
import type { Engine } from '@maelstrom-co/engine';
import { handleEnvelope } from '@maelstrom-co/engine';

type Send = (event: unknown) => void;

/** Emit a terminal rejection without invoking the Engine. */
export function rejectWorkspaceRun(
  input: WorkspaceRun,
  send: Send,
  message: string,
) {
  send({ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId });
  send({
    type: 'RUN_ERROR',
    code: 'WORKSPACE_STOPPED',
    message,
    rawEvent: { threadId: input.threadId, runId: input.runId },
  });
}

/** Host-independent admission and acknowledgment state for one socket session. */
export class AguiWorkspaceSession {
  private state: WorkspaceCheckpoint;
  private running = false;

  /** Restore non-content evidence through a host-owned synchronous checkpoint store. */
  constructor(
    threadId: string,
    checkpoint?: unknown,
    private readonly save: (state: WorkspaceCheckpoint) => void = () => {},
  ) {
    this.state =
      checkpoint === undefined
        ? { threadId, sequence: 0, revision: 0, stopped: false, pending: null }
        : WorkspaceCheckpointSchema.parse(checkpoint);
    if (this.state.threadId !== threadId)
      throw new Error('Workspace session mismatch');
    // Legacy digests used locale-dependent ordering and cannot certify new evidence.
    if (this.state.pending && this.state.pending.digestVersion !== 2)
      this.state = { ...this.state, stopped: true };
  }

  /** Fence pending work and persist retirement; throws if the host checkpoint fails. */
  close() {
    this.state = { ...this.state, stopped: true };
    this.save(this.state);
  }

  /** Dispatch a validated operation, preserving Engine entry and application gating. */
  async run(
    input: WorkspaceRun,
    getEngine: () => Engine | null | Promise<Engine | null>,
    send: Send,
  ) {
    const operation = input.forwardedProps;
    if (
      this.running ||
      this.state.stopped ||
      input.threadId !== this.state.threadId ||
      operation.sequence !== this.state.sequence + 1
    ) {
      this.close();
      rejectWorkspaceRun(input, send, 'Workspace sequence rejected.');
      return;
    }
    this.running = true;
    this.state = { ...this.state, sequence: operation.sequence };
    send({ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId });
    try {
      if (operation.kind === 'plan') {
        if (
          this.state.pending ||
          operation.revision !== this.state.revision ||
          operation.message.sessionId !== input.threadId
        )
          throw new Error('Invalid planning boundary');
        // A reset during planning cannot turn the request into a replayable write.
        this.save({ ...this.state, stopped: true });
        const engine = await getEngine();
        if (this.state.stopped) throw new Error('Session retired');
        if (!engine) throw new Error('Engine unavailable');
        const reply = await handleEnvelope(engine, operation.message);
        if (this.state.stopped || reply?.type !== 'engine.maelstrom.response') {
          throw new Error('Planning did not produce a workspace');
        }
        const correlation = {
          threadId: input.threadId,
          runId: input.runId,
          requestId: operation.message.id,
          callId: crypto.randomUUID(),
          revision: this.state.revision,
        };
        const actionsDigest = await actionDigest(reply.response.executionPlan);
        if (this.state.stopped) throw new Error('Session retired');
        this.state = {
          ...this.state,
          pending: { correlation, actionsDigest, digestVersion: 2 },
        };
        this.save(this.state);
        send({
          type: 'CUSTOM',
          name: WORKSPACE_RESULT,
          value: { correlation, envelope: reply },
        });
      } else {
        const { application } = operation;
        const pending = this.state.pending;
        if (
          !pending ||
          !sameCorrelation(pending.correlation, application.correlation)
        ) {
          throw new Error('Unmatched application result');
        }
        const succeeded =
          application.status === 'applied' &&
          application.actions.every((a) => a.succeeded);
        if (
          succeeded &&
          (await actionDigest(application.actions)) !== pending.actionsDigest
        ) {
          throw new Error('Incomplete application result');
        }
        if (this.state.stopped) throw new Error('Session retired');
        this.state = {
          ...this.state,
          pending: null,
          revision: this.state.revision + 1,
          stopped: !succeeded,
        };
        this.save(this.state);
        send({
          type: 'CUSTOM',
          name: APPLICATION_RESULT,
          value: {
            correlation: application.correlation,
            revision: this.state.revision,
            status: succeeded
              ? 'applied'
              : application.status === 'failed'
                ? 'failed'
                : 'unknown',
          },
        });
      }
      send({
        type: 'RUN_FINISHED',
        threadId: input.threadId,
        runId: input.runId,
      });
    } catch {
      try {
        this.close();
      } finally {
        send({
          type: 'RUN_ERROR',
          code: 'WORKSPACE_STOPPED',
          message: 'Workspace run stopped.',
          rawEvent: { threadId: input.threadId, runId: input.runId },
        });
      }
    } finally {
      this.running = false;
    }
  }
}
