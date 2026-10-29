import type { AgentConnection, Engine } from '@maelstrom-co/engine';
import {
  AgentEventMessage,
  encodeEnvelope,
  type SessionId,
} from '@maelstrom-co/protocol';

export interface AgentTransport {
  readonly sessionId: SessionId;
  readonly connection: AgentConnection;
}

export function openAgentTransport(
  engine: Engine,
  sessionId: SessionId,
  send: (wire: string) => void,
): AgentTransport {
  const connection = engine.openConnection({
    sessionId,
    user: null,
    capabilities: [],
  });
  connection.subscribe((event) => {
    send(encodeEnvelope(AgentEventMessage({ sessionId, event })));
  });
  return { sessionId, connection };
}
