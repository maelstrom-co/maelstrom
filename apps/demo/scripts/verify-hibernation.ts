/**
 * Deployed-only gate: proves a SessionDO that hibernates mid-session
 * recovers via `playground.rehello` without losing the visitor's buffered
 * request.
 *
 * Locally meaningless — workerd does not hibernate on production's
 * schedule, so a `wrangler dev` run can never exercise this path. This
 * script only means something against a genuinely deployed Worker that has
 * gone idle long enough to actually hibernate.
 *
 * The one failure mode that matters: a run where the object never actually
 * hibernated still produces a clean round trip and LOOKS like success. That
 * is not a pass — it proves nothing about the rehello recovery path. This
 * script tells the three outcomes apart explicitly, in both the exit code
 * and the printed output:
 *
 *   PASS         (exit 0) — socket survived the idle gap, a
 *                 `playground.rehello` was observed, and the buffered frame
 *                 was replayed with a correlated reply.
 *   INCONCLUSIVE (exit 2) — a reply came back but no rehello was ever seen:
 *                 the object stayed resident and hibernation was never
 *                 exercised. Re-run with a longer idle gap; do not record
 *                 this as a pass.
 *   FAIL         (exit 1) — the socket survived to the end but died across
 *                 the idle gap itself, or no reply came back at all. Also
 *                 used for usage/setup errors.
 *
 * A fourth case exits fast rather than waiting out the idle gap: if the
 * socket closes or errors at ANY point before a verdict above is reached
 * (bad host, bad key, Worker not deployed, or a mid-gap drop), that is a
 * CONNECTION FAILURE — a distinct diagnostic, exit 1 — printed immediately
 * instead of burning the rest of the idle window on a run that was never
 * going to prove anything about hibernation.
 *
 * Usage:
 *   SPIKE_OPENAI_KEY=sk-... bun run apps/demo/scripts/verify-hibernation.ts \
 *     <host> [idle-minutes]
 *
 *   <host>          required, e.g. maelstrom-playground-spike.<account>.workers.dev
 *   [idle-minutes]  optional, default 15
 */
import {
  ChartRequestMessage,
  encodeEnvelope,
  SessionId,
} from '@maelstrom-co/protocol';

const DEFAULT_IDLE_MINUTES = 15;
const REPLY_WAIT_MS = 30_000;
const PROGRESS_INTERVAL_MS = 60_000;
// Mirrors playground-frames.ts's MIN_API_KEY_LENGTH. Checked client-side so
// a short key fails before any socket opens — the server-side floor would
// otherwise reject the hello, close the socket, and waste part of the idle
// window on a check this script can do for free up front.
const MIN_API_KEY_LENGTH = 20;

/**
 * Built through the real codec rather than hand-written JSON: a probe that
 * sends a frame the server rejects as undecodable would report a failure
 * that says nothing about hibernation.
 */
function chartRequestWire(sessionId: string): string {
  return encodeEnvelope(
    ChartRequestMessage({
      sessionId: SessionId(sessionId),
      request: {
        type: 'chart_request',
        context: {
          updateReasons: [
            { type: 'user_intent', intent: 'show me the weather' },
          ],
          chartDimensions: { rows: 8, columns: 12 },
          layoutMode: 'grid',
        },
        instances: [],
        vessels: [],
        layout: { type: 'grid', positions: [] },
      },
    }),
  );
}

/**
 * Best-effort `type` field extraction for a diagnostic line — never throws,
 * so a malformed or non-JSON frame prints `"unparseable"` instead of
 * crashing the script mid-verdict.
 */
function frameType(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === 'string'
      ? (parsed as { type: string }).type
      : 'unparseable';
  } catch {
    return 'unparseable';
  }
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  console.error(
    'usage: SPIKE_OPENAI_KEY=sk-... bun run apps/demo/scripts/verify-hibernation.ts <host> [idle-minutes]',
  );
  process.exit(1);
}

const host = process.argv[2];
if (!host) {
  fail(
    'missing <host> (e.g. maelstrom-playground-spike.<account>.workers.dev)',
  );
}

const idleMinutesArg = process.argv[3];
const idleMinutes =
  idleMinutesArg === undefined ? DEFAULT_IDLE_MINUTES : Number(idleMinutesArg);
if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) {
  fail(
    `idle-minutes must be a positive number, got ${JSON.stringify(idleMinutesArg)}`,
  );
}

// Sent over the wire to the deployed Worker — that IS the point, it walks
// the same playground.hello path a real visitor takes — but it must never
// be logged. Nothing below may console.log/error a value derived from
// `apiKey`.
const apiKey = process.env.SPIKE_OPENAI_KEY;
if (!apiKey) {
  fail(
    'set SPIKE_OPENAI_KEY to a real OpenAI key (min 20 chars) — it is sent over the wire to the deployed Worker, but this script never logs it',
  );
}
if (apiKey.length < MIN_API_KEY_LENGTH) {
  fail(
    `SPIKE_OPENAI_KEY is ${apiKey.length} chars; the server's isPlaygroundHello requires at least ${MIN_API_KEY_LENGTH} — a shorter key would open a socket only to be rejected by it, wasting part of the idle window`,
  );
}

const session = `hib-${process.pid}`;
const frames: string[] = [];
let rehelloAt = 0;

console.log(`connecting to wss://${host}/ws?session=${session} ...`);
const ws = new WebSocket(`wss://${host}/ws?session=${session}`);

// True only once the run has reached its own deliberate verdict (including
// the `ws.close()` that produces it). Until then, any close or error is a
// CONNECTION failure, not a hibernation result, and must be reported —
// distinctly, immediately — rather than silently waited out across the
// idle gap, which is the scarcest resource this script is built around.
let settled = false;

function connectionFailure(reason: string): never {
  console.error('');
  console.error('=== CONNECTION FAILURE (not a hibernation result) ===');
  console.error(reason);
  console.error(
    'This is a connection problem (bad host, bad key, Worker not deployed),',
  );
  console.error(
    'not a hibernation-recovery failure — fix it and re-run rather than',
  );
  console.error('blaming the rehello path for this.');
  process.exit(1);
}

// Persistent for the whole run, not just until the initial connect
// resolves: a socket that dies minutes into the idle gap (not just at
// connect time) must fail fast too, instead of being discovered only after
// the full idle wait has already elapsed.
ws.onclose = (event) => {
  if (settled) return;
  connectionFailure(
    `socket closed unexpectedly (code=${event.code}, reason=${JSON.stringify(event.reason)}) before the run reached a verdict.`,
  );
};
ws.onerror = () => {
  if (settled) return;
  connectionFailure(
    'WebSocket error before the run reached a verdict (bad host, TLS failure, connection refused, or similar).',
  );
};

ws.onmessage = (event) => {
  const data = String(event.data);
  frames.push(data);
  if (data.includes('playground.rehello')) {
    rehelloAt = Date.now();
    console.log('  <- playground.rehello observed; resending key');
    ws.send(
      JSON.stringify({ type: 'playground.hello', sessionId: session, apiKey }),
    );
  }
};

await new Promise<void>((resolve) => {
  ws.onopen = () => resolve();
});
console.log('connected; sending initial playground.hello');
ws.send(
  JSON.stringify({ type: 'playground.hello', sessionId: session, apiKey }),
);

// Proves #keys survives a cross-EVENT lookup in a live isolate before the
// idle gap even starts: this fresh chart_request lands on a webSocketMessage
// invocation separate from the one that processed the hello above, and a
// pass here depends on this.#keys.get(ws) resolving the SAME connection's
// key across that boundary. If per-connection identity were not stable
// across events, this would already fail-fast here instead of only showing
// up as a mystery after the idle gap. It also warms the engine, so the
// post-wake replay below rebuilds a real engine rather than exercising a
// first-ever construction.
console.log('sending a warm-up chart_request to prove cross-event key lookup');
const warmupBefore = frames.length;
ws.send(chartRequestWire(session));
await new Promise((resolve) => setTimeout(resolve, REPLY_WAIT_MS));
const warmupReply = frames
  .slice(warmupBefore)
  .find((f) => f.includes('"type":"engine.maelstrom.response"'));
if (!warmupReply) {
  const seenTypes = frames
    .slice(warmupBefore)
    .map((f) => frameType(f))
    .join(', ');
  connectionFailure(
    `warm-up chart_request never got a correlated engine.maelstrom.response ` +
      `before the idle gap even started (saw: ${seenTypes || 'nothing'}). ` +
      'This means cross-event WebSocket/key identity is not stable, or the ' +
      'engine could not be built — investigate before trusting any PASS ' +
      'this script has ever printed.',
  );
}
console.log('  -> warm-up reply received; cross-event key lookup confirmed');

console.log(
  `idling ${idleMinutes}m to force hibernation — this is expected to take a while, the process has not hung...`,
);
const idleMs = idleMinutes * 60_000;
const idleStart = Date.now();
await new Promise<void>((resolve) => {
  const ticker = setInterval(() => {
    const elapsedMin = ((Date.now() - idleStart) / 60_000).toFixed(1);
    console.log(`  ... still idling, ${elapsedMin}/${idleMinutes}m elapsed`);
  }, PROGRESS_INTERVAL_MS);
  setTimeout(() => {
    clearInterval(ticker);
    resolve();
  }, idleMs);
});

console.log('idle gap elapsed; sending the frame that should trigger rehello');
const before = frames.length;
ws.send(chartRequestWire(session));
await new Promise((resolve) => setTimeout(resolve, REPLY_WAIT_MS));

// From here on the run has reached its own verdict — the close below is
// deliberate, not a connection failure, and must not be reported as one.
settled = true;
const sawRehello = frames.some((f) => f.includes('playground.rehello'));
const replaySlice = frames.slice(before);
// Must be the actual chart response, not merely something starting with
// "engine." — engine.error matches that prefix just as readily, so a run
// where the replay came back "session engine unavailable" would otherwise
// print PASS on a failed replay.
const sawReply = replaySlice.some((f) =>
  f.includes('"type":"engine.maelstrom.response"'),
);
const stillOpen = ws.readyState === WebSocket.OPEN;
ws.close();

console.log('');
console.log('=== verify-hibernation result ===');
console.log(`socket survived idle gap : ${stillOpen}`);
console.log(`rehello requested        : ${sawRehello}`);
console.log(`buffered frame replayed  : ${sawReply}`);
if (rehelloAt)
  console.log(`recovery latency         : ${Date.now() - rehelloAt}ms`);
if (!sawReply && replaySlice.length > 0) {
  const seenTypes = replaySlice.map((f) => frameType(f)).join(', ');
  console.log(
    `reply received but wrong type — saw: ${seenTypes} (wanted engine.maelstrom.response)`,
  );
}
console.log('');

// sawRehello === false with sawReply === true means the object never
// actually hibernated during the idle gap — the round trip looks clean but
// proves nothing about the rehello recovery path. That combination must
// never be reported as a pass.
if (!stillOpen || !sawReply) {
  console.log(
    'FAIL — socket died across the idle gap, or no correlated engine.maelstrom.response was ever received.',
  );
  process.exit(1);
}
if (!sawRehello) {
  console.log(
    'INCONCLUSIVE — a reply came back but no playground.rehello was ever observed.',
  );
  console.log(
    `The object stayed resident for the entire ${idleMinutes}m idle gap, so hibernation`,
  );
  console.log(
    'was never exercised. This is NOT a pass. Re-run with a longer idle gap.',
  );
  process.exit(2);
}
console.log(
  'PASS — socket survived hibernation, rehello was observed, and the buffered frame was replayed.',
);
process.exit(0);
