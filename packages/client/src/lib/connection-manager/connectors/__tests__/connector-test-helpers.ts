import {
  ChartRequestMessage,
  type MessageId,
  SessionId,
  type ChartRequest,
  type ChartRequestMessage as ChartRequestMessageType,
} from '@maelstrom-co/protocol';

import { FakeWebSocket } from './fake-websocket.js';

/**
 * Shared envelope fixture for connector wire-contract tests — keeps
 * protocol-shape drift breaking in one place.
 */
export const buildEnvelope = (id: MessageId): ChartRequestMessageType => {
  const request: ChartRequest = {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'show me' }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'grid',
    },
    instances: [],
    vessels: [],
    layout: { type: 'grid', positions: [] },
  };
  return ChartRequestMessage({
    sessionId: SessionId('session-1'),
    id,
    request,
  });
};

/**
 * Drives the connector through `connect()` to the OPEN state and returns
 * the FakeWebSocket the connector instantiated. The microtask is needed so
 * the `WebSocket` constructor + `addEventListener` calls run before we
 * reach for the instance.
 */
export const connectAndOpen = async (connector: {
  connect: (sessionId: SessionId) => Promise<void>;
}): Promise<FakeWebSocket> => {
  const connectPromise = connector.connect(SessionId('session-1'));
  await Promise.resolve();
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error('FakeWebSocket was not constructed');
  ws.emitOpen();
  await connectPromise;
  return ws;
};
