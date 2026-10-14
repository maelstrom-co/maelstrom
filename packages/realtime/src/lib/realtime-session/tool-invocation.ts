import type { OperationalOutcome } from '@maelstrom-co/telemetry/integration';
import type { ToolCallEvent } from './session-event-bus.js';

export interface ToolInvocation {
  readonly id: symbol;
  result: OperationalOutcome;
  durationMs?: number;
}
const invocations = new WeakMap<ToolCallEvent, ToolInvocation>();

export function tagToolInvocation<Event extends ToolCallEvent>(
  event: Event,
  invocation: ToolInvocation,
): Event {
  invocations.set(event, invocation);
  return event;
}

export function toolInvocation(
  event: ToolCallEvent,
): ToolInvocation | undefined {
  return invocations.get(event);
}
