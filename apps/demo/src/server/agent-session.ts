// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
/**
 * One Agent Session per connection: a stateful conversation that runs a
 * multi-step tool-calling loop and delegates every UI change to the existing
 * stateless Planner (the Engine), one Planner call per "show X". In-memory
 * only: no durability, resume or budgets.
 */
import type { Engine } from '@maelstrom-co/engine';
import {
  type ActionExecution,
  ChartRequestMessage,
  ChartRequestSchema,
  isErr,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  type AnyTextAdapter,
  chat,
  createModel,
  extendAdapter,
  type ModelMessage,
  maxIterations,
} from '@tanstack/ai';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import { z } from 'zod';
import type {
  AgentChartSnapshot,
  AgentClientFrame,
  AgentInputFrame,
  AgentServerFrame,
  AgentTimedStep,
  AgentTurnMetrics,
  ClientToolName,
} from './agent-session-frames';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  type AgentToolContext,
  type AgentToolHooks,
} from './agent-session-tools';
import { DEFAULT_ENGINE_MODEL } from './engine-model';

const MAX_LOOP_ITERATIONS = 12;
const CLIENT_TOOL_TIMEOUT_MS = 120_000;
const UI_APPLIED_TIMEOUT_MS = 15_000;
const HISTORY_MAX_MESSAGES = 40;

const agentEnv =
  typeof process !== 'undefined'
    ? process.env
    : ({} as Record<string, string | undefined>);

/** Model for the router and the tool loop; `AGENT_MODEL` overrides it. */
export const AGENT_MODEL = agentEnv.AGENT_MODEL?.trim() || DEFAULT_ENGINE_MODEL;

/**
 * Reasoning effort for the tool loop. gpt-6-luna on the Responses API calls
 * tools at every effort (none, low, medium were all probed), so this is a
 * latency knob, not a capability switch.
 */
const LOOP_REASONING_EFFORT = agentEnv.AGENT_REASONING_EFFORT?.trim() || 'low';
const ROUTER_REASONING_EFFORT = 'none';

const RouteSchema = z.object({
  route: z
    .enum(['ui_only', 'needs_tools'])
    .describe(
      'ui_only when one screen change satisfies the request with no data lookup; needs_tools otherwise.',
    ),
});

const ROUTER_PROMPT = `Classify the customer's latest request to a pet-food shop UI.
ui_only: a single screen change that the UI can do on its own, e.g. "show my past orders", "open my most recent order", "show the cart", "make the catalog bigger", "hide checkout".
needs_tools: anything that needs looking up and reasoning over data before acting, several steps, references to earlier results ("it", "that one"), adding to cart, checkout or placing an order, comparisons, recommendations.`;

export interface AgentSessionOptions {
  readonly engine: Engine;
  readonly apiKey: string;
  /** Pushes a frame to this connection. The transport redacts secrets. */
  readonly send: (wire: string) => void;
}

export class AgentSession {
  readonly #engine: Engine;
  readonly #adapter: AnyTextAdapter;
  readonly #send: (wire: string) => void;
  readonly #messages: ModelMessage[] = [];
  readonly #pendingClientTools = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #pendingUiApplied = new Map<string, () => void>();
  #chart: AgentChartSnapshot | null = null;
  #uiQueue: Promise<void> = Promise.resolve();
  #turnActive = false;
  #turnId = '';
  #inputCount = 0;
  #turn: TurnRecorder | null = null;
  #lastPlannerMessage = '';

  constructor(options: AgentSessionOptions) {
    this.#engine = options.engine;
    this.#send = options.send;
    this.#adapter = createAgentChat(
      AGENT_MODEL as OpenAIChatModel,
      options.apiKey,
    );
  }

  /** Routes one inbound Agent Session frame. Never throws. */
  receive(frame: AgentClientFrame): void {
    switch (frame.type) {
      case 'agent.input':
        void this.#startTurn(frame);
        return;
      case 'agent.tool.result': {
        const pending = this.#pendingClientTools.get(frame.callId);
        if (!pending) return;
        this.#pendingClientTools.delete(frame.callId);
        if (frame.ok) pending.resolve(frame.value);
        else pending.reject(new Error(frame.error));
        return;
      }
      case 'agent.ui.applied': {
        this.#chart = frame.chart;
        const resolve = this.#pendingUiApplied.get(frame.uiId);
        this.#pendingUiApplied.delete(frame.uiId);
        resolve?.();
        return;
      }
    }
  }

  async #startTurn(frame: AgentInputFrame): Promise<void> {
    if (this.#turnActive) {
      this.#push({
        type: 'agent.done',
        turnId: frame.turnId,
        ok: false,
        busy: true,
        reply:
          'I am still working on your previous request. Ask again once it finishes.',
        metrics: null,
      });
      return;
    }
    this.#turnActive = true;
    this.#turnId = frame.turnId;
    this.#chart = frame.chart;
    const turn = new TurnRecorder();
    this.#turn = turn;
    this.#lastPlannerMessage = '';
    if (this.#inputCount++ === 0)
      this.#push({ type: 'agent.progress', text: 'Working on it…' });

    const text =
      frame.input.kind === 'user_text'
        ? frame.input.text
        : `[Outside event from ${frame.input.source}] ${frame.input.description}`;
    try {
      const route = await turn.time('router', () =>
        this.#route(text).catch((error: unknown) => {
          console.warn(
            '[agent-session] router failed, using the tool loop:',
            error instanceof Error ? error.message : error,
          );
          return 'needs_tools' as const;
        }),
      );
      turn.route = route;
      turn.routerMs = turn.lastMs;
      const reply =
        route === 'ui_only'
          ? await this.#runFastRoute(text)
          : await this.#runToolLoop(text);
      this.#finishTurn(true, reply);
    } catch (error) {
      turn.route = turn.route ?? 'error';
      this.#finishTurn(
        false,
        'Something went wrong.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async #route(text: string): Promise<'ui_only' | 'needs_tools'> {
    // Plain user and assistant text only: a tool message without its call
    // makes the structured-output request invalid.
    const recent = this.#messages
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          !message.toolCalls?.length &&
          typeof message.content === 'string' &&
          message.content.length > 0,
      )
      .slice(-4);
    const result = await chat({
      adapter: this.#adapter,
      systemPrompts: [ROUTER_PROMPT],
      messages: [...recent, { role: 'user', content: text }],
      outputSchema: RouteSchema,
      stream: false,
      modelOptions: { reasoning: { effort: ROUTER_REASONING_EFFORT } },
    } as Parameters<typeof chat>[0]);
    return (result as unknown as z.infer<typeof RouteSchema>).route;
  }

  async #runFastRoute(text: string): Promise<string> {
    this.#showUi(text);
    await this.#waitForScreen();
    const reply = this.#lastPlannerMessage || 'Done.';
    this.#remember(text, reply);
    return reply;
  }

  async #runToolLoop(text: string): Promise<string> {
    const turn = this.#requireTurn();
    const hooks: AgentToolHooks = {
      onToolStart: (name, visibility) => {
        if (visibility.visibility === 'shown')
          this.#push({
            type: 'agent.progress',
            text: visibility.label,
            tool: name,
          });
      },
      onToolEnd: (name, ms) => turn.toolCalls.push({ name, ms: round(ms) }),
    };
    const tools = AGENT_TOOLS.map((tool) =>
      tool.bind(this.#toolContext(), hooks),
    );
    this.#messages.push({ role: 'user', content: text });

    const finished: { messages: readonly ModelMessage[] | null } = {
      messages: null,
    };
    const stream = chat({
      adapter: this.#adapter,
      systemPrompts: [AGENT_SYSTEM_PROMPT, this.#screenSummary()],
      messages: this.#messages,
      tools,
      agentLoopStrategy: maxIterations(MAX_LOOP_ITERATIONS),
      modelOptions: { reasoning: { effort: LOOP_REASONING_EFFORT } },
      middleware: [
        {
          onIteration: () => {
            turn.modelTurns++;
          },
          onFinish: (context) => {
            finished.messages = [...context.messages];
          },
        },
      ],
    } as Parameters<typeof chat>[0]) as AsyncIterable<{
      type: string;
      delta?: string;
      message?: string;
    }>;

    let buffer = '';
    let heldText = '';
    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') buffer += chunk.delta ?? '';
      else if (chunk.type === 'TEXT_MESSAGE_END') {
        heldText = buffer.trim() || heldText;
        buffer = '';
      } else if (chunk.type === 'TOOL_CALL_START') {
        const progress = (heldText || buffer).trim();
        if (progress) this.#push({ type: 'agent.progress', text: progress });
        heldText = '';
        buffer = '';
      } else if (chunk.type === 'RUN_ERROR') {
        throw new Error(chunk.message ?? 'agent loop failed');
      }
    }
    const reply = (heldText || buffer).trim() || 'Done.';
    // Waits for screen changes still in flight so `agent.done` arrives last.
    await this.#waitForScreen();

    this.#messages.length = 0;
    this.#messages.push(
      ...(finished.messages ?? [{ role: 'user' as const, content: text }]),
    );
    const last = this.#messages.at(-1);
    if (!(last?.role === 'assistant' && last.content === reply))
      this.#messages.push({ role: 'assistant', content: reply });
    this.#trimHistory();
    console.log(
      `[agent-session] history roles ${this.#messages.map((message) => message.role).join(',')}`,
    );
    return reply;
  }

  #toolContext(): AgentToolContext {
    return {
      showUi: (intent) => {
        this.#showUi(intent);
        return 'Screen change requested; it will appear shortly. Continue.';
      },
      waitForScreen: () => this.#waitForScreen(),
      showUiAndWait: async (intent) => {
        this.#showUi(intent);
        return this.#waitForScreen();
      },
      runActions: async (executionPlan) => {
        this.#enqueueUi(() => this.#pushDirectActions(executionPlan));
        return this.#waitForScreen();
      },
      callClientTool: (tool, args) => this.#callClientTool(tool, args),
    };
  }

  #showUi(intent: string): void {
    this.#enqueueUi(() => this.#plannerUi(intent));
  }

  // Serialized so each Planner call sees the chart the previous one produced.
  #enqueueUi(job: () => Promise<void>): void {
    this.#uiQueue = this.#uiQueue.then(job).catch((error: unknown) => {
      console.warn(
        '[agent-session] ui change failed:',
        error instanceof Error ? error.message : error,
      );
    });
  }

  async #waitForScreen(): Promise<AgentChartSnapshot> {
    await this.#uiQueue;
    if (!this.#chart) throw new Error('No chart snapshot from the browser');
    return this.#chart;
  }

  async #plannerUi(intent: string): Promise<void> {
    const chart = this.#chart;
    if (!chart) throw new Error('No chart snapshot from the browser');
    const turn = this.#turn;
    const parsed = ChartRequestSchema.safeParse({
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent }],
        chartDimensions: chart.chartDimensions,
        layoutMode: chart.layoutMode,
      },
      instances: chart.instances,
      vessels: chart.vessels,
      layout: chart.layout,
    });
    if (!parsed.success)
      throw new Error(`Chart snapshot rejected: ${parsed.error.message}`);

    const started = performance.now();
    const result = await this.#engine.handle(
      ChartRequestMessage({
        sessionId: SessionId(chart.sessionId),
        request: parsed.data as Parameters<
          typeof ChartRequestMessage
        >[0]['request'],
      }),
    );
    turn?.plannerCalls.push({
      name: intent.slice(0, 60),
      ms: round(performance.now() - started),
    });
    if (isErr(result)) throw new Error(result.error.message);
    if (result.value.type !== 'chart_response')
      throw new Error(`Unexpected engine output ${result.value.type}`);
    const response = result.value.response;
    this.#lastPlannerMessage = response.userMessage;
    await this.#pushUiAndAwaitApplied({
      source: 'planner',
      userMessage: response.userMessage,
      layout: response.layout,
      executionPlan: response.executionPlan,
    });
  }

  #pushDirectActions(executionPlan: readonly ActionExecution[]): Promise<void> {
    return this.#pushUiAndAwaitApplied({
      source: 'direct',
      userMessage: '',
      executionPlan,
    });
  }

  #pushUiAndAwaitApplied(
    change: Omit<
      Extract<AgentServerFrame, { type: 'agent.ui' }>,
      'type' | 'uiId'
    >,
  ): Promise<void> {
    const uiId = crypto.randomUUID();
    this.#turn?.markFirstUi();
    const applied = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingUiApplied.delete(uiId);
        resolve();
      }, UI_APPLIED_TIMEOUT_MS);
      this.#pendingUiApplied.set(uiId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.#push({ type: 'agent.ui', uiId, ...change });
    return applied;
  }

  #callClientTool(tool: ClientToolName, args: unknown): Promise<unknown> {
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingClientTools.delete(callId);
        reject(new Error(`Client tool ${tool} timed out`));
      }, CLIENT_TOOL_TIMEOUT_MS);
      this.#pendingClientTools.set(callId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#push({ type: 'agent.tool.request', callId, tool, args });
    });
  }

  #finishTurn(ok: boolean, reply: string, error?: string): void {
    const turn = this.#requireTurn();
    const metrics = turn.toMetrics();
    console.log(
      `[agent-session] turn ${ok ? 'done' : 'failed'} ${JSON.stringify({ ...metrics, ...(error ? { error } : {}) })}`,
    );
    this.#push({
      type: 'agent.done',
      turnId: this.#turnId,
      ok,
      reply,
      ...(error ? { error } : {}),
      metrics,
    });
    this.#turn = null;
    this.#turnActive = false;
  }

  #screenSummary(): string {
    const chart = this.#chart;
    if (!chart) return 'Screen: unknown.';
    const lines = chart.instances.map(
      (instance) => `- ${instance.vesselId} (${instance.variant})`,
    );
    return `Vessel instances currently on the chart:\n${lines.join('\n') || '- none'}`;
  }

  #remember(text: string, reply: string): void {
    this.#messages.push(
      { role: 'user', content: text },
      { role: 'assistant', content: reply },
    );
    this.#trimHistory();
  }

  // Cut only at a user message so tool calls never lose their results.
  #trimHistory(): void {
    if (this.#messages.length <= HISTORY_MAX_MESSAGES) return;
    const overflow = this.#messages.length - HISTORY_MAX_MESSAGES;
    const cut = this.#messages.findIndex(
      (message, index) => index >= overflow && message.role === 'user',
    );
    if (cut > 0) this.#messages.splice(0, cut);
  }

  #requireTurn(): TurnRecorder {
    if (!this.#turn) throw new Error('No active turn');
    return this.#turn;
  }

  #push(frame: AgentServerFrame): void {
    this.#send(JSON.stringify(frame));
  }
}

class TurnRecorder {
  readonly startedAt = performance.now();
  route: AgentTurnMetrics['route'] | null = null;
  routerMs: number | null = null;
  firstUiMs: number | null = null;
  lastMs = 0;
  modelTurns = 0;
  readonly plannerCalls: AgentTimedStep[] = [];
  readonly toolCalls: AgentTimedStep[] = [];

  async time<T>(_label: string, run: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await run();
    } finally {
      this.lastMs = round(performance.now() - started);
    }
  }

  markFirstUi(): void {
    this.firstUiMs ??= round(performance.now() - this.startedAt);
  }

  toMetrics(): AgentTurnMetrics {
    return {
      route: this.route ?? 'error',
      routerMs: this.routerMs,
      firstUiMs: this.firstUiMs,
      plannerCalls: this.plannerCalls,
      toolCalls: this.toolCalls,
      modelTurns: this.modelTurns,
      totalMs: round(performance.now() - this.startedAt),
    };
  }
}

const createAgentChatAdapter = extendAdapter(createOpenaiChat, [
  createModel(AGENT_MODEL, ['text', 'image']),
]);

function createAgentChat(
  model: OpenAIChatModel,
  apiKey: string,
): AnyTextAdapter {
  return createAgentChatAdapter(model, apiKey);
}

function round(ms: number): number {
  return Math.round(ms);
}
