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
  AgentModelCall,
  AgentServerFrame,
  AgentTimedStep,
  AgentTimelineEvent,
  AgentTurnMetrics,
  ClientToolName,
} from './agent-session-frames';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_TOOLS,
  type AgentToolContext,
  type AgentToolHooks,
} from './agent-session-tools';
import { DEFAULT_ENGINE_MODEL, onEngineModelCall } from './engine-model';
import {
  type ObservedCall,
  type ObservedCallStart,
  observeOpenaiCalls,
} from './openai-call-observer';

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

/**
 * How a turn picks between one Planner call and the tool loop: `luna` asks
 * the agent model first, `jev` asks TypeSafe Jev first, `off` always runs
 * the loop, and `parallel` starts the loop while the Luna router runs and
 * aborts it before any tool runs when the router answers `ui_only`.
 * Unset, it is `jev` when TypeSafe is configured (about 0.3 s against 1 to
 * 3 s for Luna) and `parallel` otherwise.
 */
const ROUTER_MODE = parseRouterMode(agentEnv.AGENT_ROUTER);
const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_ROUTER_TIMEOUT_MS = 5000;

type Route = 'ui_only' | 'needs_tools';

const RouteSchema = z.object({
  route: z
    .enum(['ui_only', 'needs_tools'])
    .describe(
      'ui_only when one screen change satisfies the request with no data lookup; needs_tools otherwise.',
    ),
});

const UI_ONLY_DESCRIPTION =
  'a single screen change that the UI can do on its own, e.g. "show my past orders", "open my most recent order", "show the cart", "make the catalog bigger", "hide checkout".';
const NEEDS_TOOLS_DESCRIPTION =
  'anything that needs looking up and reasoning over data before acting, several steps, references to earlier results ("it", "that one"), adding to cart, checkout or placing an order, comparisons, recommendations.';
const ROUTER_PROMPT = `Classify the customer's latest request to a pet-food shop UI.
ui_only: ${UI_ONLY_DESCRIPTION}
needs_tools: ${NEEDS_TOOLS_DESCRIPTION}`;

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
  readonly #pendingUiApplied = new Map<string, (error?: string) => void>();
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
    this.#adapter = observeOpenaiCalls(
      createAgentChat(AGENT_MODEL as OpenAIChatModel, options.apiKey),
      (start) =>
        this.#turn?.modelCall(start.structured ? 'router' : 'loop', start),
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
        resolve?.(frame.error);
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
    turn.mark('turn.start');
    this.#lastPlannerMessage = '';
    if (this.#inputCount++ === 0)
      this.#push({ type: 'agent.progress', text: 'Working on it…' });

    const text =
      frame.input.kind === 'user_text'
        ? frame.input.text
        : `[Outside event from ${frame.input.source}] ${frame.input.description}`;
    try {
      const reply = await this.#runRoutedTurn(text);
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

  async #runRoutedTurn(text: string): Promise<string> {
    const turn = this.#requireTurn();
    if (ROUTER_MODE === 'off') {
      turn.route = 'needs_tools';
      return (await this.#runToolLoop(text)) ?? 'Done.';
    }
    const routed = this.#timedRoute(text);
    if (ROUTER_MODE === 'parallel') {
      const reply = await this.#runToolLoop(text, routed);
      if (reply !== null) {
        turn.route = 'needs_tools';
        return reply;
      }
      turn.route = 'ui_only';
      return this.#runFastRoute(text);
    }
    const route = await routed;
    turn.route = route;
    return route === 'ui_only'
      ? this.#runFastRoute(text)
      : ((await this.#runToolLoop(text)) ?? 'Done.');
  }

  async #timedRoute(text: string): Promise<Route> {
    const turn = this.#requireTurn();
    const started = performance.now();
    const route = await (ROUTER_MODE === 'jev'
      ? this.#routeWithJev(text)
      : this.#route(text)
    ).catch((error: unknown) => {
      console.warn(
        '[agent-session] router failed, using the tool loop:',
        error instanceof Error ? error.message : error,
      );
      return 'needs_tools' as const;
    });
    turn.routerMs = round(performance.now() - started);
    turn.mark('router.decided', route);
    return route;
  }

  async #routeWithJev(text: string): Promise<Route> {
    const apiKey = agentEnv.TYPESAFE_API_KEY?.trim();
    const model = agentEnv.JEV_MODEL?.trim();
    if (!apiKey || !model)
      throw new Error('AGENT_ROUTER=jev needs TYPESAFE_API_KEY and JEV_MODEL');
    const turn = this.#turn;
    turn?.mark('router.start', `jev ${model}`);
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        state: {
          recentConversation: this.#recentText().map(
            (message) => `${message.role}: ${message.content}`,
          ),
          latestRequest: text,
        },
        questions: {
          route: {
            type: 'choice',
            instructions:
              "Classify the customer's latest request to a pet-food shop UI.",
            criteria: {
              ui_only: UI_ONLY_DESCRIPTION,
              needs_tools: NEEDS_TOOLS_DESCRIPTION,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(JEV_ROUTER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Jev router HTTP ${response.status}`);
    const reply = (await response.json()) as {
      answers?: { route?: { choice?: string; confidence?: number } };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const answer = reply.answers?.route;
    turn?.mark(
      'router.end',
      `jev ${answer?.choice} confidence=${answer?.confidence} in=${reply.usage?.input_tokens} out=${reply.usage?.output_tokens}`,
    );
    if (answer?.choice !== 'ui_only' && answer?.choice !== 'needs_tools')
      throw new Error('Jev router returned no route');
    return answer.choice;
  }

  async #route(text: string): Promise<Route> {
    const result = await chat({
      adapter: this.#adapter,
      systemPrompts: [ROUTER_PROMPT],
      messages: [...this.#recentText(), { role: 'user', content: text }],
      outputSchema: RouteSchema,
      stream: false,
      modelOptions: { reasoning: { effort: ROUTER_REASONING_EFFORT } },
    } as Parameters<typeof chat>[0]);
    return (result as unknown as z.infer<typeof RouteSchema>).route;
  }

  // Plain user and assistant text only: a tool message without its call
  // makes the structured-output request invalid.
  #recentText(): ModelMessage[] {
    return this.#messages
      .filter(
        (message) =>
          (message.role === 'user' || message.role === 'assistant') &&
          !message.toolCalls?.length &&
          typeof message.content === 'string' &&
          message.content.length > 0,
      )
      .slice(-4);
  }

  async #runFastRoute(text: string): Promise<string> {
    this.#showUi(text);
    await this.#waitForScreen();
    const reply = this.#lastPlannerMessage || 'Done.';
    this.#remember(text, reply);
    return reply;
  }

  /**
   * Runs the tool loop. With `routeGate` it resolves null, having undone
   * its history change, when the router answers `ui_only` before any tool
   * ran; tools wait for the router before they run.
   */
  async #runToolLoop(
    text: string,
    routeGate?: Promise<Route>,
  ): Promise<string | null> {
    const turn = this.#requireTurn();
    const hooks: AgentToolHooks = {
      onToolStart: (name, visibility) => {
        turn.mark(`tool.${name}.start`);
        if (visibility.visibility === 'shown')
          this.#push({
            type: 'agent.progress',
            text: visibility.label,
            tool: name,
          });
      },
      onToolEnd: (name, ms) => {
        turn.mark(`tool.${name}.end`);
        turn.toolCalls.push({ name, ms: round(ms) });
      },
    };
    const tools = AGENT_TOOLS.map((tool) =>
      tool.bind(this.#toolContext(), hooks),
    );
    const userMessage: ModelMessage = { role: 'user', content: text };
    this.#messages.push(userMessage);

    const finished: { messages: readonly ModelMessage[] | null } = {
      messages: null,
    };
    const abortController = new AbortController();
    const gate = { settled: false, abortedForUiOnly: false };
    void routeGate?.then((route) => {
      if (route !== 'ui_only' || gate.settled) return;
      gate.abortedForUiOnly = true;
      turn.mark('loop.aborted', 'router chose ui_only');
      abortController.abort();
    });
    const stream = chat({
      adapter: this.#adapter,
      systemPrompts: [AGENT_SYSTEM_PROMPT, this.#screenSummary()],
      messages: this.#messages,
      tools,
      agentLoopStrategy: maxIterations(MAX_LOOP_ITERATIONS),
      modelOptions: { reasoning: { effort: LOOP_REASONING_EFFORT } },
      abortController,
      middleware: [
        {
          onIteration: () => {
            turn.modelTurns++;
          },
          onBeforeToolCall: async () => {
            if (!routeGate || (await routeGate) !== 'ui_only') return;
            gate.abortedForUiOnly = true;
            return { type: 'abort', reason: 'router chose ui_only' };
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
      state?: string;
      content?: string;
    }>;

    let buffer = '';
    let heldText = '';
    try {
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
        } else if (
          chunk.type === 'TOOL_CALL_RESULT' &&
          chunk.state === 'output-error'
        ) {
          turn.mark('tool.error', chunk.content?.slice(0, 200));
        } else if (chunk.type === 'RUN_ERROR') {
          if (gate.abortedForUiOnly) break;
          throw new Error(chunk.message ?? 'agent loop failed');
        }
      }
    } catch (error) {
      if (!gate.abortedForUiOnly) throw error;
    } finally {
      gate.settled = true;
    }
    if (gate.abortedForUiOnly) {
      const index = this.#messages.lastIndexOf(userMessage);
      if (index >= 0) this.#messages.splice(index);
      return null;
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
      runActions: (executionPlan) =>
        new Promise((resolve, reject) => {
          this.#enqueueUi(async () => {
            const error = await this.#pushDirectActions(executionPlan);
            if (error)
              reject(new Error(`Action failed in the browser: ${error}`));
            else if (this.#chart) resolve(this.#chart);
            else reject(new Error('No chart snapshot from the browser'));
          });
        }),
      callClientTool: (tool, args) => this.#callClientTool(tool, args),
    };
  }

  #showUi(intent: string): void {
    this.#turn?.mark('planner.enqueue', intent.slice(0, 80));
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
    turn?.mark('planner.dequeue');
    const unsubscribe = onEngineModelCall((start) =>
      turn?.modelCall('planner', start),
    );
    const result = await this.#engine
      .handle(
        ChartRequestMessage({
          sessionId: SessionId(chart.sessionId),
          request: parsed.data as Parameters<
            typeof ChartRequestMessage
          >[0]['request'],
        }),
      )
      .finally(unsubscribe);
    turn?.mark('planner.end', isErr(result) ? 'error' : 'ok');
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

  #pushDirectActions(
    executionPlan: readonly ActionExecution[],
  ): Promise<string | undefined> {
    return this.#pushUiAndAwaitApplied({
      source: 'direct',
      userMessage: '',
      executionPlan,
    });
  }

  /** Resolves with the browser's apply error, if any, once it acked. */
  #pushUiAndAwaitApplied(
    change: Omit<
      Extract<AgentServerFrame, { type: 'agent.ui' }>,
      'type' | 'uiId'
    >,
  ): Promise<string | undefined> {
    const uiId = crypto.randomUUID();
    const turn = this.#turn;
    turn?.markFirstUi();
    turn?.mark(
      'ui.push',
      `${change.source} ${change.executionPlan.map((action) => action.action).join(',') || 'layout'}`,
    );
    const applied = new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.#pendingUiApplied.delete(uiId);
        turn?.mark('ui.ack', 'timeout');
        resolve(undefined);
      }, UI_APPLIED_TIMEOUT_MS);
      this.#pendingUiApplied.set(uiId, (error) => {
        clearTimeout(timer);
        turn?.mark('ui.ack', error);
        resolve(error);
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
    turn.mark('done', ok ? 'ok' : 'failed');
    const metrics = turn.toMetrics();
    const {
      timeline: _timeline,
      modelCalls: _modelCalls,
      ...summary
    } = metrics;
    console.log(
      `[agent-session] turn ${ok ? 'done' : 'failed'} ${JSON.stringify({ ...summary, ...(error ? { error } : {}) })}\n${formatTimeline(metrics)}`,
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
  modelTurns = 0;
  readonly plannerCalls: AgentTimedStep[] = [];
  readonly toolCalls: AgentTimedStep[] = [];
  readonly timeline: AgentTimelineEvent[] = [];
  readonly modelCalls: AgentModelCall[] = [];
  readonly #callCounts = new Map<string, number>();

  sinceStart(): number {
    return round(performance.now() - this.startedAt);
  }

  mark(event: string, detail?: string): void {
    this.timeline.push({
      atMs: this.sinceStart(),
      event,
      ...(detail ? { detail } : {}),
    });
  }

  /** Records one model request: start, first streamed output and usage. */
  modelCall(kind: string, start: ObservedCallStart): ObservedCall {
    const count = (this.#callCounts.get(kind) ?? 0) + 1;
    this.#callCounts.set(kind, count);
    const label = kind === 'router' ? kind : `${kind}${count}`;
    const startMs = this.sinceStart();
    let firstOutputMs: number | null = null;
    this.mark(`${label}.start`, start.reasoningEffort);
    return {
      onFirstOutput: () => {
        firstOutputMs = this.sinceStart() - startMs;
        this.mark(`${label}.first_output`);
      },
      onEnd: ({ ok, usage }) => {
        const call: AgentModelCall = {
          label,
          reasoningEffort: start.reasoningEffort ?? null,
          startMs,
          firstOutputMs,
          ms: this.sinceStart() - startMs,
          ok,
          inputTokens: usage?.inputTokens ?? null,
          cachedTokens: usage?.cachedTokens ?? null,
          reasoningTokens: usage?.reasoningTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        };
        this.modelCalls.push(call);
        this.mark(`${label}.end`, formatUsage(call));
      },
    };
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
      timeline: this.timeline,
      modelCalls: this.modelCalls,
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

function formatUsage(call: AgentModelCall): string {
  const status = call.ok ? '' : 'FAILED ';
  if (call.inputTokens === null) return `${status}${call.ms}ms`;
  return `${status}${call.ms}ms in=${call.inputTokens} cached=${call.cachedTokens} reasoning=${call.reasoningTokens} out=${call.outputTokens}`;
}

function formatTimeline(metrics: AgentTurnMetrics): string {
  return metrics.timeline
    .map(
      (entry) =>
        `  ${String(entry.atMs).padStart(6)}ms ${entry.event}${entry.detail ? ` ${entry.detail}` : ''}`,
    )
    .join('\n');
}

function parseRouterMode(
  value: string | undefined,
): 'luna' | 'jev' | 'off' | 'parallel' {
  const mode =
    value?.trim() ||
    (agentEnv.TYPESAFE_API_KEY?.trim() && agentEnv.JEV_MODEL?.trim()
      ? 'jev'
      : 'parallel');
  if (
    mode === 'luna' ||
    mode === 'jev' ||
    mode === 'off' ||
    mode === 'parallel'
  )
    return mode;
  throw new Error(
    `AGENT_ROUTER must be luna, jev, off or parallel, got "${mode}"`,
  );
}
