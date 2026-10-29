import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentFinishReason,
  type DiagnosticMetadata,
  type MessageId,
  type RunId,
} from '@maelstrom-co/protocol';

export interface RunFailure {
  readonly error: string;
  readonly code: string;
  readonly reason?: AgentFinishReason;
}

export interface RunEnding {
  readonly events: readonly AgentEvent[];
  readonly metadata: DiagnosticMetadata;
}

export function buildAcceptanceEvents(
  inputId: MessageId,
  runId: RunId,
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
      disposition: 'ui_only',
      ack: 'On it.',
    },
  ];
}

export function buildRunEnding(
  run: { readonly runId: RunId; readonly started: number },
  now: number,
  reply: string,
  failure?: RunFailure,
): RunEnding {
  const { runId } = run;
  const reason = failure?.reason ?? (failure ? 'error' : 'completed');
  const metrics = {
    turns: 0,
    toolCalls: 0,
    elapsedMs: Math.max(0, Math.round(now - run.started)),
    inputTokens: 0,
    outputTokens: 0,
  };
  const message: AgentEvent[] = failure
    ? []
    : [
        {
          type: 'message',
          version: AGENT_WIRE_VERSION,
          runId,
          turnId: `${runId}:reply`,
          delta: reply,
        },
      ];
  return {
    events: [
      ...message,
      {
        type: 'finished',
        version: AGENT_WIRE_VERSION,
        runId,
        ...failure,
        ok: !failure,
        reason,
        reply: failure ? '' : reply,
        metrics,
      },
    ],
    metadata: {
      reason,
      outcome: failure ? 'failed' : 'succeeded',
      ...metrics,
      ...(failure ? { code: failure.code } : {}),
    },
  };
}
