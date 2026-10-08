// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
/**
 * Browser half of the Agent Session prototype: sends `agent.input`, applies
 * `agent.ui` (layout first, then actions), runs client tools, and keeps the
 * progress strip and debug metrics state for the /shop page.
 */
import { buildChartRequest, type Orchestrator } from '@maelstrom-co/client';
import type { ActionExecution } from '@maelstrom-co/protocol';
import { useSyncExternalStore } from 'react';
import {
  type AgentChartSnapshot,
  type AgentClientFrame,
  type AgentServerFrame,
  type AgentToolRequestFrame,
  type AgentTurnMetrics,
  type AgentUiFrame,
  parseAgentServerFrame,
} from '../server/agent-session-frames';
import { cartTotals, getCartSnapshot } from '../vessels/cart.store';
import { formatCents } from './pet-shop-fixtures';

export interface AgentProgressEntry {
  readonly text: string;
  readonly tool?: string;
}

export interface AgentSessionClientState {
  readonly active: boolean;
  readonly progress: readonly AgentProgressEntry[];
  readonly reply: string | null;
  readonly error: string | null;
  readonly metrics: AgentTurnMetrics | null;
}

const INITIAL_STATE: AgentSessionClientState = {
  active: false,
  progress: [],
  reply: null,
  error: null,
  metrics: null,
};

/** How an Agent Session turn ended, as voice and text callers see it. */
export interface AgentTurnOutcome {
  readonly ok: boolean;
  readonly reply: string;
  readonly busy: boolean;
}

// Below the OpenAI Live adapter's 120s batch bound, which ends voice on expiry.
const TURN_RESULT_TIMEOUT_MS = 100_000;

let state = INITIAL_STATE;
let activeTurnId: string | null = null;
const pendingTurns = new Map<string, (outcome: AgentTurnOutcome) => void>();
let currentSend: ((data: string) => void) | null = null;
let currentOrchestrator: Orchestrator | null = null;
const listeners = new Set<() => void>();

/** Remembers the live socket's raw send; called from the connector's onOpen. */
export function attachAgentChannel(send: (data: string) => void): void {
  currentSend = send;
}

/** Points UI application at the /shop page's orchestrator while it is mounted. */
export function registerAgentOrchestrator(
  orchestrator: Orchestrator,
): () => void {
  currentOrchestrator = orchestrator;
  return () => {
    if (currentOrchestrator === orchestrator) currentOrchestrator = null;
  };
}

/**
 * Consumes an inbound `agent.*` frame. Returns false for everything else, and
 * also when no /shop page is mounted, so other pages see no difference.
 */
export function handleAgentFrame(
  raw: string,
  send: (data: string) => void,
): boolean {
  const frame = parseAgentServerFrame(raw);
  if (!frame || !currentOrchestrator) return false;
  void routeFrame(frame, currentOrchestrator, send);
  return true;
}

/** Starts an Agent Session turn with the user's typed text. */
export function sendAgentUserText(text: string): void {
  void runAgentTurn(text);
}

/**
 * Runs one Agent Session turn for text or voice and resolves with its reply.
 * Never rejects: a busy session, a missing channel or a stalled turn all
 * resolve with a speakable reply instead.
 */
export function runAgentTurn(text: string): Promise<AgentTurnOutcome> {
  const orchestrator = currentOrchestrator;
  const send = currentSend;
  if (!send || !orchestrator) {
    setState({ ...state, error: 'Agent channel is not connected yet.' });
    return Promise.resolve({
      ok: false,
      busy: false,
      reply: 'The shop assistant is not connected yet.',
    });
  }
  if (activeTurnId !== null)
    return Promise.resolve({
      ok: false,
      busy: true,
      reply:
        'I am still working on your previous request. Ask again once it finishes.',
    });

  const turnId = crypto.randomUUID();
  activeTurnId = turnId;
  setState({
    active: true,
    progress: [],
    reply: null,
    error: null,
    metrics: state.metrics,
  });
  const outcome = new Promise<AgentTurnOutcome>((resolve) => {
    const timer = setTimeout(() => {
      pendingTurns.delete(turnId);
      if (activeTurnId === turnId) {
        activeTurnId = null;
        setState({ ...state, active: false });
      }
      resolve({
        ok: false,
        busy: false,
        reply:
          'This is taking longer than expected; the screen will update when it is ready.',
      });
    }, TURN_RESULT_TIMEOUT_MS);
    pendingTurns.set(turnId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
  sendFrame(send, {
    type: 'agent.input',
    turnId,
    input: { kind: 'user_text', text },
    chart: readChartSnapshot(orchestrator),
  });
  return outcome;
}

export function useAgentSessionClient(): AgentSessionClientState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

async function routeFrame(
  frame: AgentServerFrame,
  orchestrator: Orchestrator,
  send: (data: string) => void,
): Promise<void> {
  switch (frame.type) {
    case 'agent.progress':
      setState({
        ...state,
        progress: [
          ...state.progress,
          { text: frame.text, ...(frame.tool ? { tool: frame.tool } : {}) },
        ],
      });
      return;
    case 'agent.ui':
      await applyAgentUi(frame, orchestrator);
      sendFrame(send, {
        type: 'agent.ui.applied',
        uiId: frame.uiId,
        chart: readChartSnapshot(orchestrator),
      });
      return;
    case 'agent.tool.request':
      // Yield first: confirm() blocks, and the socket handler should return.
      await new Promise((resolve) => setTimeout(resolve, 0));
      sendFrame(send, runClientTool(frame));
      return;
    case 'agent.done': {
      pendingTurns.get(frame.turnId)?.({
        ok: frame.ok,
        reply: frame.reply,
        busy: frame.busy === true,
      });
      pendingTurns.delete(frame.turnId);
      if (frame.turnId !== activeTurnId) return;
      activeTurnId = null;
      setState({
        ...state,
        active: false,
        reply: frame.reply,
        error: frame.error ?? null,
        metrics: frame.metrics,
      });
      console.info('[agent-session] metrics', frame.metrics);
      return;
    }
  }
}

// Same order as Orchestrator#dispatchResponse: set_layout, then
// execute_actions, as one atomic batch so actions can target new instances.
async function applyAgentUi(
  frame: AgentUiFrame,
  orchestrator: Orchestrator,
): Promise<void> {
  const executionPlan = frame.executionPlan as readonly ActionExecution[];
  orchestrator.commandProcessor.dispatch(
    ...(frame.layout
      ? [{ kind: 'set_layout' as const, layout: frame.layout }]
      : []),
    { kind: 'execute_actions', executionPlan },
  );
  await orchestrator.commandProcessor.waitForIdle();
}

function runClientTool(frame: AgentToolRequestFrame): AgentClientFrame {
  try {
    if (frame.tool === 'get_cart') {
      const { lines } = getCartSnapshot();
      const totals = cartTotals(lines);
      return {
        type: 'agent.tool.result',
        callId: frame.callId,
        ok: true,
        value: { lines, totals, totalText: formatCents(totals.totalCents) },
      };
    }
    const question =
      (frame.args as { question?: string } | null)?.question ?? 'Continue?';
    return {
      type: 'agent.tool.result',
      callId: frame.callId,
      ok: true,
      value: { approved: window.confirm(question) },
    };
  } catch (error) {
    return {
      type: 'agent.tool.result',
      callId: frame.callId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readChartSnapshot(orchestrator: Orchestrator): AgentChartSnapshot {
  const request = buildChartRequest({
    updates: [],
    instances: orchestrator.commandProcessor.store.state.instances,
    chartDimensions: orchestrator.chartManager.store.state.chartDimensions,
    layout: orchestrator.commandProcessor.store.state.layout,
    vessels: orchestrator.vesselManager.getAll(),
    config: { layoutMode: orchestrator.getConfig().layoutMode },
  });
  return {
    sessionId: orchestrator.getConfig().sessionId,
    chartDimensions: request.context.chartDimensions,
    layoutMode: request.context.layoutMode,
    instances: request.instances,
    vessels: request.vessels,
    layout: request.layout,
  };
}

function sendFrame(
  send: (data: string) => void,
  frame: AgentClientFrame,
): void {
  send(JSON.stringify(frame));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AgentSessionClientState {
  return state;
}

function setState(next: AgentSessionClientState): void {
  state = next;
  for (const listener of listeners) listener();
}
