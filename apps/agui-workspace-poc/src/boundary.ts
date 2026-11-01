import { EventType } from '@ag-ui/core';
import type { StreamChunk } from '@tanstack/ai';

// TanStack 1.0 emits model-turn terminals and client-tool interrupts. Keep its
// runtime internal; the external frontend-tool exchange uses AG-UI success.
export async function* toAgui(
  stream: AsyncIterable<StreamChunk>,
  approvalToolCallId?: string,
): AsyncIterable<StreamChunk> {
  let terminal: Extract<StreamChunk, { type: 'RUN_FINISHED' }> | undefined;
  let started = false;
  let failed = false;
  const pending = new Set<string>();
  for await (const event of stream) {
    if (failed) throw new Error('Event after run failure');
    if (event.type === 'RUN_STARTED') {
      if (started) throw new Error('Duplicate run start');
      started = true;
    }
    if (event.type === 'TOOL_CALL_START') pending.add(event.toolCallId);
    if (event.type === 'TOOL_CALL_RESULT') pending.delete(event.toolCallId);
    if (event.type === 'RUN_FINISHED') {
      terminal = event;
      continue;
    }
    if (event.type === 'RUN_ERROR') failed = true;
    yield event;
  }
  if (failed || !terminal) return;
  if (terminal.outcome?.type === 'interrupt') {
    const interrupts = terminal.outcome.interrupts;
    const childApproval =
      approvalToolCallId !== undefined &&
      interrupts.length === 1 &&
      interrupts[0]?.toolCallId === approvalToolCallId &&
      interrupts[0]?.metadata?.kind === 'approval';
    if (!childApproval) {
      if (
        interrupts.some(
          (i) =>
            i.reason !== 'tanstack:client_tool_execution' ||
            !i.toolCallId ||
            !pending.has(i.toolCallId),
        ) ||
        interrupts.length !== pending.size
      )
        throw new Error('Unsupported interrupt kind');
      terminal = {
        ...terminal,
        type: EventType.RUN_FINISHED,
        outcome: { type: 'success', pendingToolCallIds: [...pending] },
      };
    }
  }
  // Model-turn usage is not an aggregate for the outer run.
  const outer = { ...terminal };
  delete outer.usage;
  yield outer;
}
