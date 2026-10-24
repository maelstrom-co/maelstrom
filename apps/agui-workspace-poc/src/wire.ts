import type { Message } from '@ag-ui/core';
import { EventSchemas, RunAgentInputSchema } from '@ag-ui/core/schemas';
import type { z } from 'zod';
import { ApplySchema, frontendTools } from './contracts.js';

export type WireEvent = z.infer<typeof EventSchemas>;

export async function decode(response: Response): Promise<WireEvent[]> {
  if (!response.ok)
    throw new Error(
      `Run rejected: ${response.status} ${await response.text()}`,
    );
  if (!response.headers.get('content-type')?.startsWith('text/event-stream'))
    throw new Error('Expected SSE');
  const body = await response.text();
  const events = body
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      if (!frame.startsWith('data: ')) throw new Error('Unexpected SSE frame');
      return EventSchemas.parse(JSON.parse(frame.slice(6)));
    });
  if (events[0]?.type !== 'RUN_STARTED') throw new Error('Missing run start');
  if (events.at(-1)?.type !== 'RUN_FINISHED')
    throw new Error(
      `Truncated or failed run; outcome unknown: ${JSON.stringify(events.at(-1))}`,
    );
  if (
    events.filter((e) => e.type === 'RUN_STARTED').length !== 1 ||
    events.filter((e) => e.type === 'RUN_FINISHED').length !== 1
  )
    throw new Error(
      `Invalid run boundaries: ${JSON.stringify(events.filter((e) => e.type === 'RUN_STARTED' || e.type === 'RUN_FINISHED'))}`,
    );
  return events;
}

export function frontendCall(events: WireEvent[]) {
  const terminal = events.at(-1);
  if (terminal?.type !== 'RUN_FINISHED') throw new Error('Run not complete');
  if (terminal.outcome && terminal.outcome.type !== 'success')
    throw new Error('Run did not finish successfully');
  const start = events.find(
    (e) => e.type === 'TOOL_CALL_START' && e.toolCallName === 'apply_workspace',
  );
  if (!start || start.type !== 'TOOL_CALL_START') return undefined;
  const startIndex = events.indexOf(start);
  const endIndex = events.findIndex(
    (e) => e.type === 'TOOL_CALL_END' && e.toolCallId === start.toolCallId,
  );
  if (endIndex <= startIndex) throw new Error('Incomplete frontend call');
  if (
    events.some(
      (e) => e.type === 'TOOL_CALL_RESULT' && e.toolCallId === start.toolCallId,
    )
  )
    throw new Error('Producer answered a frontend call');
  const argumentsJson = events
    .slice(startIndex + 1, endIndex)
    .flatMap((e) =>
      e.type === 'TOOL_CALL_ARGS' && e.toolCallId === start.toolCallId
        ? [e.delta]
        : [],
    )
    .join('');
  return {
    id: start.toolCallId,
    argumentsJson,
    input: ApplySchema.parse(JSON.parse(argumentsJson)),
  };
}

export function toolHistory(events: WireEvent[]): Message[] {
  const snapshot = events.findLast((e) => e.type === 'MESSAGES_SNAPSHOT');
  if (snapshot?.type === 'MESSAGES_SNAPSHOT') return snapshot.messages;
  throw new Error('Missing TanStack conversation snapshot');
}

export function runRequest(messages: Message[], run = 1) {
  return RunAgentInputSchema.parse({
    threadId: 'workspace-poc',
    runId: `run-${run}`,
    ...(run > 1 ? { parentRunId: `run-${run - 1}` } : {}),
    state: {},
    tools: frontendTools,
    context: [],
    forwardedProps: {},
    messages,
  });
}

export function post(body: unknown, signal?: AbortSignal) {
  return new Request('http://localhost/agui-poc/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
