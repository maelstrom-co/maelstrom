import type { Page } from '@playwright/test';

/** One JSON text frame seen on a page WebSocket, tagged with its direction. */
export interface CollectedFrame {
  readonly direction: 'sent' | 'received';
  readonly payload: Record<string, unknown>;
}

/** The inner input or event an agent frame carries, keyed by its `type`. */
export interface AgentWirePayload {
  readonly type: string;
  readonly [field: string]: unknown;
}

/**
 * Collects every JSON text frame on the page's WebSockets from now on. Call
 * it before navigating so the first frames are not missed. Non-JSON and
 * binary frames are ignored.
 */
export function collectWebSocketFrames(page: Page): CollectedFrame[] {
  const frames: CollectedFrame[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const parsed = parseJsonObject(payload);
      if (parsed) frames.push({ direction: 'sent', payload: parsed });
    });
    socket.on('framereceived', ({ payload }) => {
      const parsed = parseJsonObject(payload);
      if (parsed) frames.push({ direction: 'received', payload: parsed });
    });
  });
  return frames;
}

/** Inputs of the `client.agent.input` frames the page has sent so far. */
export function sentAgentInputs(
  frames: readonly CollectedFrame[],
): AgentWirePayload[] {
  return innerObjects(frames, 'sent', 'client.agent.input', 'input');
}

/** Events of the `engine.agent.event` frames the page has received so far. */
export function receivedAgentEvents(
  frames: readonly CollectedFrame[],
): AgentWirePayload[] {
  return innerObjects(frames, 'received', 'engine.agent.event', 'event');
}

function innerObjects(
  frames: readonly CollectedFrame[],
  direction: CollectedFrame['direction'],
  envelopeType: string,
  field: string,
): AgentWirePayload[] {
  return frames.flatMap((frame) => {
    if (frame.direction !== direction) return [];
    if (frame.payload.type !== envelopeType) return [];
    const inner = frame.payload[field];
    if (!isRecord(inner) || typeof inner.type !== 'string') return [];
    return [inner as AgentWirePayload];
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
