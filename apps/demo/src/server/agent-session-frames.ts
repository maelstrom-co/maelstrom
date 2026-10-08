// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
/**
 * Demo-only wire frames for the Agent Session prototype. Browser-safe (type
 * imports only) so the connector can share these definitions with the server.
 */
import type {
  ActionExecution,
  ChartDimensions,
  GridLayout,
  LayoutMode,
  TilingLayout,
  Vessel,
  VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

/** The browser's chart state at the moment it sent a frame. */
export interface AgentChartSnapshot {
  readonly sessionId: string;
  readonly chartDimensions: ChartDimensions;
  readonly layoutMode: LayoutMode;
  readonly instances: readonly VesselInstanceSnapshot[];
  readonly vessels: readonly Vessel[];
  readonly layout: GridLayout | TilingLayout;
}

/** What can start an Agent Session turn. Only `user_text` is wired. */
export type AgentInput =
  | { readonly kind: 'user_text'; readonly text: string }
  | {
      readonly kind: 'outside_event';
      readonly source: string;
      readonly description: string;
      readonly payload?: unknown;
    };

export type ClientToolName = 'get_cart' | 'ask_user';

export interface AgentInputFrame {
  readonly type: 'agent.input';
  /** Client-chosen id echoed on this turn's `agent.done`. */
  readonly turnId: string;
  readonly input: AgentInput;
  readonly chart: AgentChartSnapshot;
}

export type AgentToolResultFrame =
  | {
      readonly type: 'agent.tool.result';
      readonly callId: string;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly type: 'agent.tool.result';
      readonly callId: string;
      readonly ok: false;
      readonly error: string;
    };

/** Sent by the browser after it applied an `agent.ui`, with the fresh chart. */
export interface AgentUiAppliedFrame {
  readonly type: 'agent.ui.applied';
  readonly uiId: string;
  readonly chart: AgentChartSnapshot;
  /** Set when applying the change failed, for example an action error. */
  readonly error?: string;
}

export type AgentClientFrame =
  | AgentInputFrame
  | AgentToolResultFrame
  | AgentUiAppliedFrame;

/**
 * A UI change to apply. `layout` is absent for a direct action-only change
 * (for example `addToCart` on a cart already on screen).
 */
export interface AgentUiFrame {
  readonly type: 'agent.ui';
  readonly uiId: string;
  readonly source: 'planner' | 'direct';
  readonly userMessage: string;
  readonly layout?: GridLayout | TilingLayout;
  readonly executionPlan: readonly ActionExecution[];
}

export interface AgentProgressFrame {
  readonly type: 'agent.progress';
  readonly text: string;
  readonly tool?: string;
}

export interface AgentToolRequestFrame {
  readonly type: 'agent.tool.request';
  readonly callId: string;
  readonly tool: ClientToolName;
  readonly args: unknown;
}

export interface AgentTimedStep {
  readonly name: string;
  readonly ms: number;
}

/** One timestamped step of a turn, relative to `agent.input` arrival. */
export interface AgentTimelineEvent {
  readonly atMs: number;
  readonly event: string;
  readonly detail?: string;
}

/** One model request made during a turn, with its provider-reported usage. */
export interface AgentModelCall {
  readonly label: string;
  readonly reasoningEffort: string | null;
  readonly startMs: number;
  /** Time from request start to the first streamed output; null when not streamed. */
  readonly firstOutputMs: number | null;
  readonly ms: number;
  readonly ok: boolean;
  readonly inputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly outputTokens: number | null;
}

export interface AgentTurnMetrics {
  readonly route: 'ui_only' | 'needs_tools' | 'error';
  readonly routerMs: number | null;
  /** Time from `agent.input` arrival to the first `agent.ui` sent. */
  readonly firstUiMs: number | null;
  readonly plannerCalls: readonly AgentTimedStep[];
  readonly toolCalls: readonly AgentTimedStep[];
  /** Model turns in the tool loop (0 on the fast route). */
  readonly modelTurns: number;
  readonly totalMs: number;
  readonly timeline: readonly AgentTimelineEvent[];
  readonly modelCalls: readonly AgentModelCall[];
}

export interface AgentDoneFrame {
  readonly type: 'agent.done';
  readonly turnId: string;
  readonly ok: boolean;
  readonly reply: string;
  readonly error?: string;
  /** True when the input was refused because another turn is running. */
  readonly busy?: boolean;
  /** Null for a refused (busy) input, which never ran. */
  readonly metrics: AgentTurnMetrics | null;
}

export type AgentServerFrame =
  | AgentUiFrame
  | AgentProgressFrame
  | AgentToolRequestFrame
  | AgentDoneFrame;

/** True for any frame the server-side Agent Session owns. */
export function isAgentClientFrame(value: unknown): value is AgentClientFrame {
  const type = frameType(value);
  return (
    type === 'agent.input' ||
    type === 'agent.tool.result' ||
    type === 'agent.ui.applied'
  );
}

/** Parses a raw inbound browser frame into an Agent Session server frame, or null. */
export function parseAgentServerFrame(raw: string): AgentServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const type = frameType(parsed);
  return type === 'agent.ui' ||
    type === 'agent.progress' ||
    type === 'agent.tool.request' ||
    type === 'agent.done'
    ? (parsed as AgentServerFrame)
    : null;
}

function frameType(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? (value as { type?: unknown }).type
    : undefined;
}
