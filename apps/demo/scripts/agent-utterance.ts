/**
 * Manual check of the local agent route: sends one utterance to the local
 * dev server and prints every agent event as one JSON line.
 *
 * Start the server with a server-held `OPENAI_API_KEY` (`nx dev demo`), then
 * run from the workspace root:
 *
 *   bun apps/demo/scripts/agent-utterance.ts "what was my last order?"
 *
 * `DEMO_WS_URL` overrides the socket URL (default `ws://localhost:3001/ws`)
 * and `AGENT_UTTERANCE_TIMEOUT_MS` the wait for `finished` (default 120000).
 * Exits 0 after `finished`, 1 on a timeout, socket error or early close.
 */
import {
  AGENT_WIRE_VERSION,
  AgentInputMessage,
  type ChartRequest,
  decodeServerEnvelope,
  encodeEnvelope,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

const DEFAULT_WS_URL = 'ws://localhost:3001/ws';
const DEFAULT_TIMEOUT_MS = 120_000;

const EMPTY_CHART: ChartRequest = {
  type: 'chart_request',
  context: {
    updateReasons: [],
    chartDimensions: { columns: 12, rows: 8 },
    layoutMode: 'tiling',
  },
  instances: [],
  vessels: [],
  layout: { type: 'tiling', tree: [], instances: [] },
};

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error(
    'Usage: bun apps/demo/scripts/agent-utterance.ts "<utterance>"',
  );
  process.exit(1);
}

const url = process.env.DEMO_WS_URL?.trim() || DEFAULT_WS_URL;
const timeoutMs =
  Number(process.env.AGENT_UTTERANCE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
const sessionId = SessionId(`agent-utterance-${crypto.randomUUID()}`);
const socket = new WebSocket(url);
let finished = false;

const timeout = setTimeout(() => {
  console.error(`No finished event within ${timeoutMs} ms.`);
  socket.close();
  process.exit(1);
}, timeoutMs);

socket.addEventListener('open', () => {
  socket.send(
    encodeEnvelope(
      AgentInputMessage({
        sessionId,
        input: {
          type: 'utterance',
          version: AGENT_WIRE_VERSION,
          inputId: MessageId(),
          text,
          chart: EMPTY_CHART,
          source: 'text',
        },
      }),
    ),
  );
});

socket.addEventListener('message', (message) => {
  const raw = typeof message.data === 'string' ? message.data : '';
  const decoded = decodeServerEnvelope(raw);
  if (!decoded.ok) {
    console.error(`Ignored frame: ${raw}`);
    return;
  }
  const envelope = decoded.value;
  if (envelope.type === 'engine.error') {
    console.error(JSON.stringify(envelope));
    return;
  }
  if (envelope.type !== 'engine.agent.event') return;
  console.log(JSON.stringify(envelope.event));
  if (envelope.event.type === 'finished') {
    finished = true;
    clearTimeout(timeout);
    socket.close();
  }
});

socket.addEventListener('error', () => {
  console.error(`WebSocket error on ${url}. Is the local dev server running?`);
});

socket.addEventListener('close', (event) => {
  clearTimeout(timeout);
  if (!finished)
    console.error(
      `Socket closed before finished (code ${event.code}${event.reason ? `, ${event.reason}` : ''}).`,
    );
  process.exit(finished ? 0 : 1);
});
