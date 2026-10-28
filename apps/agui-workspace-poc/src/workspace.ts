import {
  type ActionRecord,
  Orchestrator,
  type PushConnector,
  readStructuralSnapshot,
} from '@maelstrom-co/client';
import {
  err,
  InstanceId,
  type MaelstromResponse,
  ok,
} from '@maelstrom-co/protocol';
import {
  type Ack,
  AckSchema,
  ApplySchema,
  type RecordFact,
  RecordSchema,
} from './contracts.js';
import { notes } from './planner.js';

export class FixtureStore {
  record?: RecordFact;
  focused?: RecordFact;
  creates = 0;
  constructor(private readonly allocate: () => string = () => 'record-73') {}
  create() {
    this.creates++;
    this.record = { id: this.allocate(), version: 1 };
  }
  read() {
    return RecordSchema.parse(this.record);
  }
  focus(value: unknown) {
    const fact = RecordSchema.parse(value);
    if (JSON.stringify(fact) !== JSON.stringify(this.record))
      throw new Error('Stale record');
    this.focused = fact;
  }
}

export class Workspace {
  readonly orchestrator: Orchestrator;
  readonly commands: string[] = [];
  revision = 0;
  private push?: (response: MaelstromResponse) => void;
  private calls = new Map<string, { input: string; result: Promise<Ack> }>();
  private busy = false;
  private closed = false;

  constructor(
    readonly store: FixtureStore,
    options: {
      actionGate?: () => Promise<void>;
      fail?: boolean;
      unavailable?: boolean;
      binding?: {
        orchestrator: Orchestrator;
        push: (response: MaelstromResponse) => void;
      };
    } = {},
  ) {
    const connector: PushConnector = {
      capabilities: { voice: false, streaming: false, stateful: false },
      connect: async () => {},
      disconnect: async () => {},
      subscribe: () => () => {},
      process: async () => {
        throw new Error('This PoC accepts AG-UI frontend tools only');
      },
      addAssistantMessage: async () => {
        throw new Error('History injection unsupported');
      },
      getHistory: async () => [],
      onPushMessage: (callback) => {
        this.push = callback;
        return () => {
          this.push = undefined;
        };
      },
    };
    this.orchestrator =
      options.binding?.orchestrator ??
      new Orchestrator(connector, {
        vessels: [notes],
        readyTimeoutMs: 10,
      });
    if (options.binding) this.push = options.binding.push;
    const processor = this.orchestrator.commandProcessor;
    let mounted = false;
    processor.events.on('command_complete', ({ command }) => {
      this.commands.push(command.kind);
      if (
        command.kind !== 'set_layout' ||
        mounted ||
        options.unavailable ||
        options.binding
      )
        return;
      if (!processor.store.state.instances.has(InstanceId('notes-1'))) return;
      mounted = true;
      // Headless mount fixture: registration follows the real layout store update.
      processor.registerRunner<typeof notes>(InstanceId('notes-1'), {
        create: async () => {
          await options.actionGate?.();
          if (options.fail) return err(new Error('Fixture Action failed'));
          store.create();
          return ok(undefined);
        },
        focus: (params) => {
          store.focus(params);
          return ok(undefined);
        },
      });
    });
  }

  snapshot() {
    return readStructuralSnapshot(this.orchestrator);
  }

  apply(callId: string, raw: unknown, signal?: AbortSignal): Promise<Ack> {
    const input = ApplySchema.parse(raw);
    const encoded = JSON.stringify(input);
    const previous = this.calls.get(callId);
    if (previous) {
      if (previous.input !== encoded)
        throw new Error('Conflicting duplicate call');
      return previous.result;
    }
    if (this.closed || this.busy) throw new Error('Workspace unavailable');
    if (this.calls.size >= 8) throw new Error('Fixture call budget exhausted');
    const result = this.applyOnce(callId, input, signal);
    this.calls.set(callId, { input: encoded, result });
    return result;
  }

  private async applyOnce(
    callId: string,
    input: ReturnType<typeof ApplySchema.parse>,
    signal?: AbortSignal,
  ): Promise<Ack> {
    const actions: ActionRecord[] = [];
    const ack = (status: Ack['status']) =>
      AckSchema.parse({
        callId,
        requestId: input.response.requestId,
        revision: this.revision,
        status,
        actions: actions.map((action) => ({
          instanceId: action.instanceId,
          action: action.action,
          status: action.skipped
            ? 'skipped'
            : action.result.ok
              ? 'succeeded'
              : 'failed',
        })),
        snapshot: this.snapshot(),
      });
    if (signal?.aborted || input.expectedRevision !== this.revision)
      return ack('rejected');
    this.busy = true;
    let aborted = false;
    const abort = () => {
      aborted = true;
      this.closed = true;
    };
    signal?.addEventListener('abort', abort, { once: true });
    const release = this.orchestrator.commandProcessor.events.on(
      'actions_completed',
      ({ result }) => actions.push(...result.actions),
    );
    try {
      if (!this.push) throw new Error('Push bridge disconnected');
      this.push(input.response);
      const result = await this.orchestrator.commandProcessor.waitForIdle();
      this.revision++;
      return ack(
        !aborted &&
          result.ok &&
          actions.length === input.response.executionPlan.length &&
          actions.every((a) => a.result.ok && !a.skipped)
          ? 'applied'
          : 'unknown',
      );
    } finally {
      release();
      signal?.removeEventListener('abort', abort);
      this.busy = false;
    }
  }

  dispose() {
    this.closed = true;
    this.orchestrator.dispose();
  }
}
