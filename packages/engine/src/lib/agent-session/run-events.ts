import {
  AGENT_WIRE_VERSION,
  type AgentDisposition,
  type AgentEvent,
  type AgentFinishReason,
  type DiagnosticMetadata,
  type MessageId,
  type RunId,
} from '@maelstrom-co/protocol';

import type { AgentRunBudgetLimit } from './agent-run.js';

export interface RunFailure {
  readonly error: string;
  readonly code: string;
  readonly reason?: AgentFinishReason;
}

export interface RunBudgetExhaustion {
  readonly reason: 'budget';
  readonly limit: AgentRunBudgetLimit;
  readonly closingMessage: string;
}

/**
 * Counters of an agent run. When present on a non-budget ending, the reply
 * was already streamed as deltas. Budget endings always emit the closing
 * message as a `message` with turn id `<runId>:close`, even with counters.
 */
export interface AgentRunCounters {
  readonly turns: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly unreportedUsageCalls: number;
}

export interface RunEnding {
  readonly events: readonly AgentEvent[];
  readonly metadata: DiagnosticMetadata;
}

export function buildAcceptanceEvents(
  inputId: MessageId,
  runId: RunId,
  disposition: Extract<AgentDisposition, 'ui_only' | 'agent'> = 'ui_only',
): readonly AgentEvent[] {
  return [
    {
      type: 'placeholder',
      version: AGENT_WIRE_VERSION,
      inputId,
      text: 'One moment.',
    },
    {
      type: 'accepted',
      version: AGENT_WIRE_VERSION,
      inputId,
      runId,
      disposition,
      ack: 'On it.',
    },
  ];
}

export function buildRunEnding(
  run: { readonly runId: RunId; readonly started: number },
  now: number,
  reply: string,
  outcome?: RunFailure | RunBudgetExhaustion,
  counters?: AgentRunCounters,
): RunEnding {
  const { runId } = run;
  const budget =
    outcome !== undefined && 'closingMessage' in outcome ? outcome : undefined;
  const failure =
    outcome !== undefined && !('closingMessage' in outcome)
      ? outcome
      : undefined;
  const ok = outcome === undefined;
  const reason =
    budget?.reason ?? failure?.reason ?? (failure ? 'error' : 'completed');
  const metrics = {
    turns: counters?.turns ?? 0,
    toolCalls: counters?.toolCalls ?? 0,
    elapsedMs: Math.max(0, Math.round(now - run.started)),
    inputTokens: counters?.inputTokens ?? 0,
    outputTokens: counters?.outputTokens ?? 0,
  };
  const finalReply = budget?.closingMessage ?? (ok ? reply : '');
  const turnId = budget ? `${runId}:close` : `${runId}:reply`;
  const message: AgentEvent[] =
    budget || (ok && counters === undefined)
      ? [
          {
            type: 'message',
            version: AGENT_WIRE_VERSION,
            runId,
            turnId,
            delta: finalReply,
          },
        ]
      : [];
  return {
    events: [
      ...message,
      {
        type: 'finished',
        version: AGENT_WIRE_VERSION,
        runId,
        ...failure,
        ok,
        reason,
        reply: finalReply,
        metrics,
      },
    ],
    metadata: {
      reason,
      outcome: ok ? 'succeeded' : 'failed',
      ...metrics,
      ...(failure ? { code: failure.code } : {}),
      ...(budget ? { limit: budget.limit } : {}),
      ...(counters
        ? { unreportedUsageCalls: counters.unreportedUsageCalls }
        : {}),
    },
  };
}
