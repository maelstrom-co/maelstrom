import { EventSchemas } from '@ag-ui/core/schemas';
import type {
  ApplicationSettlement,
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
  OperationSchema,
  PlanSchema,
  StateSchema,
} from './agui-contract';

async function bounded<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
  owner?: AbortSignal,
): Promise<T> {
  const deadline = new AbortController();
  const signal = owner
    ? AbortSignal.any([owner, deadline.signal])
    : deadline.signal;
  let reject!: (reason: unknown) => void;
  const expired = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => deadline.abort(new Error('Experimental request timed out')),
    timeoutMs,
  );
  try {
    signal.throwIfAborted();
    return await Promise.race([work(signal), expired]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

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
  private retirement: Promise<void> | undefined;
  private binding = 0;
  private workStarted = false;
  private abort = new AbortController();
  private handlers = new Set<(event: ConnectorEvent) => void>();
  private listeners = new Set<() => void>();
  private pending: AgentPlan | undefined;
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
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Display observers cannot prevent retirement or protocol settlement.
      }
    }
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
    try {
      const body = await bounded(10_000, async (signal) => {
        const result = await this.post(
          {
            sessionId: this.sessionId,
            mode: this.mode,
            ...(this.mode === 'live' ? { apiKey: this.apiKey } : {}),
          },
          signal,
        );
        return z.object({ token: z.string() }).parse(await result.json());
      });
      this.token = body.token;
      if (this.closed) throw new Error('Experimental session retired');
    } finally {
      this.apiKey = null;
    }
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
  retire(): Promise<void> {
    if (this.retirement) return this.retirement;
    this.closed = true;
    this.apiKey = null;
    this.abort.abort();
    this.retirement = (async () => {
      await this.connection?.catch(() => undefined);
      const token = this.token;
      this.token = undefined;
      if (token) await this.deleteSession(token);
    })();
    this.publish({ ...this.state, phase: 'stopped' });
    return this.retirement;
  }
  private async deleteSession(token: string) {
    await bounded(10_000, (signal) =>
      fetch('/api/experimental-agui', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
        signal,
      }),
    ).catch(() => undefined);
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
  private async post(body: unknown, signal = this.abort.signal) {
    const response = await fetch('/api/experimental-agui', {
      method: 'POST',
      signal,
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
  private run(operation: AgentOperation) {
    return bounded(
      60_000,
      (signal) => this.runWithSignal(operation, signal),
      this.abort.signal,
    );
  }
  private async runWithSignal(operation: AgentOperation, signal: AbortSignal) {
    const runId = crypto.randomUUID();
    const response = await this.post(
      {
        threadId: this.sessionId,
        runId,
        messages: [],
        tools: [],
        context: [],
        state: null,
        forwardedProps: operation,
      },
      signal,
    );
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

  async applicationSettled(settlement: ApplicationSettlement): Promise<void> {
    try {
      const plan = this.pending;
      if (
        !plan ||
        this.closed ||
        plan.correlation.requestId !== settlement.requestId
      )
        throw new Error('Unmatched application settlement');
      const chart = settlement.chart;
      const ack = {
        correlation: plan.correlation,
        status: settlement.result.status,
        chart: {
          ...chart,
          layout: chart.layout?.type === 'tiling' ? chart.layout : null,
        },
        actions: settlement.actions,
        journal: getJournalSnapshot(),
      };
      const { value } = await this.run(
        OperationSchema.parse({ kind: 'ack', ack }),
      );
      const state = StateSchema.parse(value);
      if (
        this.closed ||
        state.revision !== plan.correlation.revision + 1 ||
        state.goalId !== plan.correlation.goalId
      )
        throw new Error('Acknowledgment response mismatch');
      this.pending = undefined;
      this.publish(state);
    } catch (error) {
      this.fail();
      throw error;
    }
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
