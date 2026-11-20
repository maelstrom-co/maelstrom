import type { AgentEvent, AgentInput } from '@maelstrom-co/protocol';
import type { Page } from '@playwright/test';

/** One JSON text frame seen on a page WebSocket, tagged with its direction and arrival time. */
export interface CollectedFrame {
  readonly direction: 'sent' | 'received';
  readonly payload: Record<string, unknown>;
  /** When the test saw the frame, in milliseconds since the epoch. */
  readonly at: number;
}

/** An agent input or event with the time its frame was seen. */
export interface Timed<T> {
  readonly value: T;
  readonly at: number;
}

/**
 * Collects every JSON-object text frame on the page's WebSockets from now on.
 * Call it before navigating so the first frames are not missed.
 */
export function collectWebSocketFrames(page: Page): CollectedFrame[] {
  const frames: CollectedFrame[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const parsed = parseJsonObject(payload);
      if (parsed)
        frames.push({ direction: 'sent', payload: parsed, at: Date.now() });
    });
    socket.on('framereceived', ({ payload }) => {
      const parsed = parseJsonObject(payload);
      if (parsed)
        frames.push({
          direction: 'received',
          payload: parsed,
          at: Date.now(),
        });
    });
  });
  return frames;
}

export function sentAgentInputs(
  frames: readonly CollectedFrame[],
): AgentInput[] {
  return timedSentAgentInputs(frames).map(({ value }) => value);
}

export function receivedAgentEvents(
  frames: readonly CollectedFrame[],
): AgentEvent[] {
  return timedReceivedAgentEvents(frames).map(({ value }) => value);
}

export function timedSentAgentInputs(
  frames: readonly CollectedFrame[],
): Timed<AgentInput>[] {
  return innerObjects(frames, 'sent', 'client.agent.input', 'input').map(
    ({ value, at }) => ({ value: value as unknown as AgentInput, at }),
  );
}

export function timedReceivedAgentEvents(
  frames: readonly CollectedFrame[],
): Timed<AgentEvent>[] {
  return innerObjects(frames, 'received', 'engine.agent.event', 'event').map(
    ({ value, at }) => ({ value: value as unknown as AgentEvent, at }),
  );
}

function innerObjects(
  frames: readonly CollectedFrame[],
  direction: CollectedFrame['direction'],
  envelopeType: string,
  field: string,
): Timed<Record<string, unknown>>[] {
  return frames.flatMap((frame) => {
    if (frame.direction !== direction) return [];
    if (frame.payload.type !== envelopeType) return [];
    const inner = frame.payload[field];
    if (!isRecord(inner) || typeof inner.type !== 'string') return [];
    return [{ value: inner, at: frame.at }];
  });
}

function parseJsonObject(
  payload: string | Buffer,
): Record<string, unknown> | undefined {
  if (typeof payload !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
