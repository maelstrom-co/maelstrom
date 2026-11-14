/**
 * Manual check of the local agent route: sends one utterance to the local
 * dev server and prints every agent event as one JSON line.
 *
 * Start the server with a server-held `OPENAI_API_KEY` (`nx dev demo`), then
 * run from the workspace root:
 *
 *   bun apps/demo/scripts/agent-utterance.ts "what was my last order?"
 *
 * `--shop` sends the pet shop Vessels and starting screen instead of an empty
 * Chart, so a loop-driven show has Instances to target. The script also
 * prints `ui_change` actions and `error` events. It sends no `ui_applied`
 * acknowledgement, so a change on the wire ends as an acknowledgement
 * timeout on the server. A shop run waits 3 seconds after `finished` to print
 * events that arrive late.
 *
 * `DEMO_WS_URL` overrides the socket URL (default `ws://localhost:3001/ws`)
 * and `AGENT_UTTERANCE_TIMEOUT_MS` the wait for `finished` (default 120000).
 *
 * Exit codes:
 *   0  `finished` arrived with `ok: true`
 *   1  `finished` with `ok: false` (reason and error code go to stderr), an
 *      `engine.error` frame for the sent input, missing input, a timeout, or
 *      a socket close before `finished`
 */
import {
  AGENT_WIRE_VERSION,
  AgentInputMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

import { buildUtteranceChart } from './agent-utterance-chart';

const DEFAULT_WS_URL = 'ws://localhost:3001/ws';
const DEFAULT_TIMEOUT_MS = 120_000;
const SHOP_SETTLE_MS = 3_000;

const args = process.argv.slice(2);
const shop = args.includes('--shop');
const text = args
  .filter((arg) => arg !== '--shop')
  .join(' ')
  .trim();
if (!text) {
  console.error(
    'Usage: bun apps/demo/scripts/agent-utterance.ts [--shop] "<utterance>"',
  );
  process.exit(1);
}

const url = process.env.DEMO_WS_URL?.trim() || DEFAULT_WS_URL;
const timeoutMs =
  Number(process.env.AGENT_UTTERANCE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
const sessionId = SessionId(`agent-utterance-${crypto.randomUUID()}`);
const socket = new WebSocket(url);
const frameId = MessageId();
let finished = false;
let finishedOk = false;

const timeout = setTimeout(() => {
  console.error(`No finished event within ${timeoutMs} ms.`);
  socket.close();
  process.exit(1);
}, timeoutMs);

socket.addEventListener('open', () => {
  socket.send(
    encodeEnvelope(
      AgentInputMessage({
        id: frameId,
        sessionId,
        input: {
          type: 'utterance',
          version: AGENT_WIRE_VERSION,
          inputId: MessageId(),
          text,
          chart: buildUtteranceChart({ shop }),
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
    if (envelope.requestId === frameId || envelope.sessionId === sessionId) {
      clearTimeout(timeout);
      socket.close();
      process.exit(1);
    }
    return;
  }
  if (envelope.type !== 'engine.agent.event') return;
  console.log(JSON.stringify(envelope.event));
  if (envelope.event.type === 'ui_change') {
    console.log(
      `ui_change runId=${envelope.event.runId} changeId=${envelope.event.changeId} actions=${JSON.stringify(envelope.event.response.executionPlan)}`,
    );
  }
  if (envelope.event.type === 'error') {
    console.error(
      `agent error${envelope.event.code ? ` (${envelope.event.code})` : ''}: ${envelope.event.error}`,
    );
  }
  if (envelope.event.type === 'finished') {
    finished = true;
    clearTimeout(timeout);
    finishedOk = envelope.event.ok;
    if (!envelope.event.ok) {
      const { reason, code, error } = envelope.event;
      console.error(
        `Agent finished without success: ${reason}${code ? ` (${code})` : ''}${error ? `: ${error}` : ''}`,
      );
    }
    // A loop-driven show can put `ui_change` and `error` events on the wire
    // after `finished`, so a shop run lingers briefly to print them.
    if (shop) setTimeout(() => socket.close(), SHOP_SETTLE_MS);
    else socket.close();
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
  process.exit(finished && finishedOk ? 0 : 1);
});
