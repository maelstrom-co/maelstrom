import type { SessionId, SidechannelEvent } from '@maelstrom-co/protocol';
import type { SessionEventHandler } from './session-event-bus.js';

/**
 * Re-emits one session's events as the public {@link SidechannelEvent}
 * stream: `tool.called`, `tool.result`, `transcript.entry` and `timing` map to
 * `tool_call`, `tool_result`, `transcript` and `timing`, stamped with
 * `sessionId` and the client clock at delivery. Every other event is ignored.
 */
export function sidechannelSubscriber(
  sessionId: SessionId,
  onEvent: (event: SidechannelEvent) => void,
): SessionEventHandler {
  return (event) => {
    switch (event.type) {
      case 'tool.called':
        onEvent({
          type: 'tool_call',
          sessionId,
          at: Date.now(),
          name: event.name,
          callId: event.callId,
          argumentsJson: event.argumentsJson,
        });
        return;
      case 'tool.result':
        onEvent({
          type: 'tool_result',
          sessionId,
          at: Date.now(),
          callId: event.callId,
          ok: event.ok,
          latencyMs: event.latencyMs,
        });
        return;
      case 'transcript.entry':
        onEvent({
          type: 'transcript',
          sessionId,
          at: Date.now(),
          role: event.role,
          text: event.text,
          final: event.final,
        });
        return;
      case 'timing':
        onEvent({
          type: 'timing',
          sessionId,
          at: Date.now(),
          label: event.label,
          ms: event.ms,
        });
        return;
      default:
        return;
    }
  };
}
