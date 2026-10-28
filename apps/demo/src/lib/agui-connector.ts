import { EventSchemas } from '@ag-ui/core/schemas';
import type {
  ConnectorEvent,
  EngineConnector,
  Orchestrator,
} from '@maelstrom-co/client';
import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  MessageId,
  type SessionId,
} from '@maelstrom-co/protocol';
import { z } from 'zod';
import { getJournalSnapshot } from '../vessels/journal.store';
import {
  type AgentOperation,
  type AgentPlan,
  type AgentState,
  type ApplicationAck,
  OperationSchema,
  PlanSchema,
  StateSchema,
} from './agui-contract';

export class AguiConnector implements EngineConnector {
  readonly capabilities = { voice: false, streaming: true, stateful: true };
  state: AgentState = {
    phase: 'ready',
    goalId: null,
    observedId: null,
    revision: 0,
  };
  private token: string | undefined;
  private sessionId = '';
  private closed = false;
  private connection: Promise<void> | undefined;
  private binding = 0;
  private workStarted = false;
  private abort = new AbortController();
  private handlers = new Set<(event: ConnectorEvent) => void>();
  private listeners = new Set<() => void>();
  private pending: AgentPlan | undefined;
  private acknowledged: Promise<void> = Promise.resolve();
  private goal: { id: string; title: string } | undefined;
  private goalStarted = false;

  constructor(
    readonly mode: 'live' | 'fixture',
    private apiKey: string | null,
  ) {}
  subscribe(handler: (event: ConnectorEvent) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  observe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  allowWrite = (action: string) => {
    if (
      this.closed ||
      !this.pending ||
      this.pending.response.executionPlan[0]?.action !== action
    )
      return false;
    if (action === 'writeContent') {
      const journal = getJournalSnapshot();
      return (
        journal.activeEntryId === this.pending.expectedEntryId &&
        journal.entries.find((e) => e.id === journal.activeEntryId)?.content ===
          ''
      );
    }
    return action === 'createEntry';
  };
  private publish(state: AgentState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  async connect(sessionId: SessionId) {
    if (this.closed) throw new Error('Experimental session retired');
    if (this.sessionId && this.sessionId !== sessionId)
      throw new Error('Experimental session identity changed');
    this.binding++;
    this.sessionId = sessionId;
    this.connection ??= this.startSession();
    await this.connection;
    if (this.closed) throw new Error('Experimental session retired');
  }
  private async startSession() {
    const result = await this.post({
      sessionId: this.sessionId,
      mode: this.mode,
      ...(this.mode === 'live' ? { apiKey: this.apiKey } : {}),
    });
    const body = z.object({ token: z.string() }).parse(await result.json());
    this.apiKey = null;
    if (this.closed) {
      await this.deleteSession(body.token);
      throw new Error('Experimental session retired');
    }
    this.token = body.token;
  }
  async disconnect() {
    if (!this.workStarted) {
      const binding = this.binding;
      // StrictMode may reconnect an unused binding in the same effect replay.
      await Promise.resolve();
      if (binding !== this.binding) return;
    }
    await this.retire();
  }
  async retire() {
    if (this.closed) return;
    this.closed = true;
    this.apiKey = null;
    this.abort.abort();
    this.publish({ ...this.state, phase: 'stopped' });
    const token = this.token;
    this.token = undefined;
    if (token) await this.deleteSession(token);
  }
  private async deleteSession(token: string) {
    await fetch('/api/experimental-agui', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => undefined);
  }
  private fail() {
    if (this.closed) return;
    void this.retire();
    for (const handler of this.handlers)
      handler({
        type: 'disconnected',
        clean: false,
        retryable: false,
        message: 'Experimental outcome unknown; no automatic retry',
      });
  }
  async addAssistantMessage() {
    throw new Error(
      'Voice and history injection are unavailable in the experiment',
    );
  }
  async getHistory() {
    return [];
  }
  private async post(body: unknown) {
    const response = await fetch('/api/experimental-agui', {
      method: 'POST',
      signal: this.abort.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`Experimental request failed (${response.status})`);
    return response;
  }
  private async run(operation: AgentOperation) {
    const runId = crypto.randomUUID();
    const response = await this.post({
      threadId: this.sessionId,
      runId,
      messages: [],
      tools: [],
      context: [],
      state: null,
      forwardedProps: operation,
    });
    const text = await response.text();
    if (this.closed) throw new Error('Session retired');
    const frames = text
      .split(/\r?\n\r?\n/)
      .filter(
        (line) => line.startsWith('data: ') && line.trim() !== 'data: [DONE]',
      );
    const events = frames.map((frame) =>
      EventSchemas.parse(JSON.parse(frame.slice(6))),
    );
    const first = events[0];
    const last = events.at(-1);
    if (
      events.length !== 3 ||
      first?.type !== 'RUN_STARTED' ||
      first.threadId !== this.sessionId ||
      first.runId !== runId ||
      last?.type !== 'RUN_FINISHED' ||
      last.threadId !== this.sessionId ||
      last.runId !== runId
    )
      throw new Error('Incomplete or mismatched AG-UI run');
    const payload = events[1];
    if (
      payload?.type !== 'CUSTOM' ||
      payload.name !==
        (operation.kind === 'plan' ? 'demo:workspace' : 'demo:state')
    )
      throw new Error('Unexpected AG-UI result');
    return { runId, value: payload.value };
  }

  async process(message: ChartRequestMessage) {
    this.workStarted = true;
    try {
      await this.acknowledged;
      if (this.closed || this.pending)
        throw new Error('Prior response has no application acknowledgment');
      const task = message.request.context.updateReasons.some(
        (r) => r.type === 'user_intent',
      );
      const goal = task ? this.goal : undefined;
      if (task) this.goal = undefined;
      const { runId, value } = await this.run(
        OperationSchema.parse({
          kind: 'plan',
          revision: this.state.revision,
          message,
          journal: getJournalSnapshot(),
          ...(goal ? { goal } : {}),
        }),
      );
      const plan = PlanSchema.parse(value);
      if (
        plan.correlation.sessionId !== this.sessionId ||
        plan.correlation.runId !== runId ||
        plan.correlation.requestId !== message.id ||
        plan.response.requestId !== message.id ||
        plan.correlation.revision !== this.state.revision ||
        plan.correlation.goalId !== (goal?.id ?? this.state.goalId)
      )
        throw new Error('Workspace correlation mismatch');
      if (
        plan.expectedEntryId &&
        getJournalSnapshot().activeEntryId !== plan.expectedEntryId
      )
        throw new Error('Journal selection changed during planning');
      this.pending = plan;
      return {
        ...plan.response,
        requestId: MessageId(plan.response.requestId),
        executionPlan: plan.response.executionPlan.map((a) => ({
          ...a,
          instanceId: InstanceId(a.instanceId),
          action: ActionName(a.action),
        })),
      };
    } catch (error) {
      this.fail();
      throw error;
    }
  }

  attach(orchestrator: Orchestrator) {
    let actions: ApplicationAck['actions'] = [];
    const matches = (requestId?: string) =>
      !!this.pending && requestId === this.pending.correlation.requestId;
    const acknowledge = (status: ApplicationAck['status']) => {
      const plan = this.pending;
      if (!plan || this.closed) return;
      const chart = orchestrator.getStructuralSnapshot();
      const ack = {
        correlation: plan.correlation,
        status,
        chart: {
          ...chart,
          layout: chart.layout?.type === 'tiling' ? chart.layout : null,
        },
        actions,
        journal: getJournalSnapshot(),
      };
      this.pending = undefined;
      actions = [];
      this.acknowledged = Promise.resolve()
        .then(() => this.run(OperationSchema.parse({ kind: 'ack', ack })))
        .then(({ value }) => {
          const state = StateSchema.parse(value);
          if (
            state.revision !== plan.correlation.revision + 1 ||
            state.goalId !== plan.correlation.goalId
          )
            throw new Error('Acknowledgment response mismatch');
          this.publish(state);
        })
        .catch(() => {
          this.fail();
        });
    };
    const releases = [
      orchestrator.commandProcessor.events.on(
        'actions_completed',
        ({ command, result }) => {
          if (matches(command.requestId))
            actions = result.actions.map((a) => ({
              instanceId: a.instanceId,
              action: a.action,
              succeeded: !a.skipped && a.result.ok,
            }));
        },
      ),
      orchestrator.commandProcessor.events.on(
        'processing_error',
        ({ command }) => {
          if (matches(command.requestId)) {
            acknowledge('failed');
          }
        },
      ),
      orchestrator.commandProcessor.events.on(
        'command_complete',
        ({ command }) => {
          if (
            !matches(command.requestId) ||
            command.kind !== 'execute_actions' ||
            !this.pending ||
            this.closed
          )
            return;
          acknowledge(
            actions.every((action) => action.succeeded) ? 'applied' : 'failed',
          );
        },
      ),
    ];
    return () => {
      for (const release of releases) release();
    };
  }

  async runGoal(orchestrator: Orchestrator, title: string) {
    if (this.goalStarted || this.state.phase !== 'ready' || this.closed) return;
    this.goalStarted = true;
    this.goal = { id: crypto.randomUUID(), title };
    const scope = orchestrator.createIntentScope();
    try {
      for (let step = 0; step < 2; step++) {
        const ticket = orchestrator.enqueueIntent(
          step === 0
            ? `Create Journal entry: ${title}`
            : 'Continue the acknowledged Journal goal',
          { scope },
        );
        if (!ticket.accepted) throw new Error('Intent admission refused');
        const result = await ticket.result;
        await this.acknowledged;
        if (
          result.status !== 'applied' ||
          this.closed ||
          (step === 0 && this.snapshot().phase !== 'annotate') ||
          (step === 1 && this.snapshot().phase !== 'complete')
        )
          throw new Error('Application did not complete the step');
      }
    } catch {
      this.fail();
    } finally {
      scope.retire();
    }
  }
}
