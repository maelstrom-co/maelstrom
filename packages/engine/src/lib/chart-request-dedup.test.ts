import { describe, expect, test } from 'bun:test';

import type { ChartRequest } from '@maelstrom-co/protocol';
import {
  AssistantInjectionMessage,
  ChartRequestMessage,
  isErr,
  isOk,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import { defer } from './__test-helpers__/defer.js';
import { buildGridResponse, makeGridRequest, silentLogger } from './__test-helpers__/fixtures.js';
import {
  blockingPlanner,
  scriptedPlanner,
} from './__test-helpers__/stub-planner.js';
import type { DedupHistoryBinding } from './chart-request-dedup.js';
import { createChartRequestDedup } from './chart-request-dedup.js';
import { createEngine } from './engine.js';
import type { HistoryStore } from './history/history-store.js';
import { createInMemoryStore } from './history/in-memory-store.js';
import type { Logger } from './logger.js';
import type { PlannerCandidate } from './planner/candidate.js';
import type { Planner } from './planner/stage.js';

const gridLLMResponse = buildGridResponse();

const DEFAULT_SESSION_ID = SessionId('session-1');
const DEFAULT_MESSAGE_ID = MessageId('req-1');

const toChartRequestMessage = (
  request: ChartRequest,
  sessionId: SessionId = DEFAULT_SESSION_ID,
  id: MessageId = DEFAULT_MESSAGE_ID,
): ChartRequestMessage => ChartRequestMessage({ sessionId, id, request });

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// History sized large enough that truncation never interferes with what
// each test pins. Tests that need truncation override `maxEntries` directly.
const IDEMPOTENCY_HISTORY = { maxEntries: 10, maxChars: 1_000 } as const;

const setupIdempotencyEngine = (
  planner: Planner,
  overrides: {
    store?: HistoryStore;
    maxEntries?: number;
    maxChars?: number;
    logger?: Logger;
  } = {},
) => {
  const store = overrides.store ?? createInMemoryStore();
  const engine = createEngine({
    planner,
    logger: overrides.logger ?? silentLogger,
    history: {
      maxEntries: overrides.maxEntries ?? IDEMPOTENCY_HISTORY.maxEntries,
      maxChars: overrides.maxChars ?? IDEMPOTENCY_HISTORY.maxChars,
      store,
    },
  });
  return { engine, store };
};

/**
 * Wraps a planner with an invocation counter, replacing the `mockChat`
 * call-count assertions the dedup tests used to pin on the mocked `chat()`.
 */
const countingPlanner = (
  inner: Planner,
): { readonly planner: Planner; readonly calls: () => number } => {
  let count = 0;
  const planner: Planner = async (input, ctx) => {
    count += 1;
    return inner(input, ctx);
  };
  return { planner, calls: () => count };
};

// Capturing logger that records every emission so tests can assert on the
// specific message + structured `data` slot. Pinning the data slot is what
// catches a regression that drops `logger.error` entirely — the surrounding
// behavioral assertions (Ok-not-Err, no double LLM call) can pass without it.
type CapturedLog = {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly error?: unknown;
  readonly data?: unknown;
};
const captureLogger = (): {
  readonly logger: Logger;
  readonly logs: ReadonlyArray<CapturedLog>;
} => {
  const logs: CapturedLog[] = [];
  const logger: Logger = {
    debug: (message, data) => {
      logs.push({ level: 'debug', message, data });
    },
    info: (message, data) => {
      logs.push({ level: 'info', message, data });
    },
    warn: (message, data) => {
      logs.push({ level: 'warn', message, data });
    },
    error: (message, error, data) => {
      logs.push({ level: 'error', message, error, data });
    },
  };
  return { logger, logs };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('engine.handle — chart_request idempotency', () => {
  test('replays the stored response on a sequential duplicate without invoking the LLM', async () => {
    const { planner, calls } = countingPlanner(scriptedPlanner([gridLLMResponse]));
    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();

    const first = await engine.handle(toChartRequestMessage(request));
    const second = await engine.handle(toChartRequestMessage(request));

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value).toEqual(first.value);
    expect(calls()).toBe(1);
  });

  test('collapses concurrent duplicates onto a single LLM call (in-flight dedup)', async () => {
    const gate = defer<PlannerCandidate>();
    // The planner parks on `gate` — only the leader ever reaches it. If a
    // second call slipped through, `calls()` would catch it directly instead
    // of relying on the mock resolving `undefined` downstream.
    const { planner: blocking, entered } = blockingPlanner(gate);
    const { planner, calls } = countingPlanner(blocking);

    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();

    const leader = engine.handle(toChartRequestMessage(request));
    await entered;
    const follower = engine.handle(toChartRequestMessage(request));

    gate.resolve(gridLLMResponse);
    const [a, b] = await Promise.all([leader, follower]);

    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(b.value).toEqual(a.value);
    expect(calls()).toBe(1);
  });

  test('leader cancellation surfaces to followers awaiting the same in-flight entry', async () => {
    // The leader's signal aborting must surface CancellationError to the
    // leader; the follower (with its own, unaborted signal) must observe
    // the same Err via the in-flight shared promise. `blockingPlanner`
    // rejects with an AbortError once the context signal it was called
    // with aborts — the same reaction the mocked adapter used to simulate.
    const gate = defer<PlannerCandidate>();
    const { planner: blocking, entered } = blockingPlanner(gate);
    const { planner, calls } = countingPlanner(blocking);

    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();

    const leaderAbort = new AbortController();
    const leader = engine.handle(
      toChartRequestMessage(request),
      leaderAbort.signal,
    );
    // Wait until the leader is registered in the in-flight map AND parked
    // inside the planner.
    await entered;
    const followerAbort = new AbortController();
    const follower = engine.handle(
      toChartRequestMessage(request),
      followerAbort.signal,
    );

    leaderAbort.abort('leader decided to cancel');

    const [leaderResult, followerResult] = await Promise.all([
      leader,
      follower,
    ]);
    expect(isErr(leaderResult)).toBe(true);
    expect(isErr(followerResult)).toBe(true);
    if (!isErr(leaderResult) || !isErr(followerResult)) return;
    expect(leaderResult.error._tag).toBe('CancellationError');
    expect(followerResult.error._tag).toBe('CancellationError');
    expect(calls()).toBe(1);
  });

  test('follower aborting its own signal does not cancel the leader', async () => {
    const gate = defer<PlannerCandidate>();
    const { planner: blocking, entered } = blockingPlanner(gate);
    const { planner, calls } = countingPlanner(blocking);

    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();

    const leader = engine.handle(toChartRequestMessage(request));
    await entered;

    const followerAbort = new AbortController();
    const follower = engine.handle(
      toChartRequestMessage(request),
      followerAbort.signal,
    );

    followerAbort.abort('follower decided not to wait');

    const followerResult = await follower;
    expect(isErr(followerResult)).toBe(true);
    if (!isErr(followerResult)) return;
    expect(followerResult.error._tag).toBe('CancellationError');

    // Leader must still be fulfillable — the planner call is still pending.
    gate.resolve(gridLLMResponse);
    const leaderResult = await leader;
    expect(isOk(leaderResult)).toBe(true);
    expect(calls()).toBe(1);
  });

  test('a duplicate after a failure reaches the LLM again (failures are not persisted)', async () => {
    let attempt = 0;
    const planner: Planner = async (input, ctx) => {
      attempt += 1;
      if (attempt === 1) throw new Error('transient provider hiccup');
      return scriptedPlanner([gridLLMResponse])(input, ctx);
    };

    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();

    const first = await engine.handle(toChartRequestMessage(request));
    expect(isErr(first)).toBe(true);

    const second = await engine.handle(toChartRequestMessage(request));
    expect(isOk(second)).toBe(true);

    expect(attempt).toBe(2);
  });

  test('truncation eviction makes the response replay miss → fresh LLM call', async () => {
    const { planner, calls } = countingPlanner(
      scriptedPlanner([gridLLMResponse, gridLLMResponse, gridLLMResponse]),
    );

    // maxEntries=1 means recording the second turn truncates the first.
    const { engine } = setupIdempotencyEngine(planner, { maxEntries: 1 });
    const request = makeGridRequest();
    const idA = MessageId('id-a');
    const idB = MessageId('id-b');

    await engine.handle(
      toChartRequestMessage(request, DEFAULT_SESSION_ID, idA),
    );
    await engine.handle(
      toChartRequestMessage(request, DEFAULT_SESSION_ID, idB),
    );
    // idA is now evicted from the store. A replay of idA must reach the LLM.
    await engine.handle(
      toChartRequestMessage(request, DEFAULT_SESSION_ID, idA),
    );

    expect(calls()).toBe(3);
  });

  test('engines without historyConfig do not deduplicate chart_requests', async () => {
    const { planner, calls } = countingPlanner(
      scriptedPlanner([gridLLMResponse, gridLLMResponse]),
    );

    // Explicitly bypassing setupIdempotencyEngine — this test pins the
    // no-history path, which the helper cannot express by construction.
    const engine = createEngine({
      planner,
      logger: silentLogger,
    });
    const request = makeGridRequest();
    await engine.handle(toChartRequestMessage(request));
    await engine.handle(toChartRequestMessage(request));

    expect(calls()).toBe(2);
  });

  test('does not collide across sessions sharing the same messageId', async () => {
    // The in-flight key is `${sessionId}::${messageId}` and the persistent
    // store keys per-session. Two concurrent in-flight requests with the
    // same messageId in DIFFERENT sessions must be processed independently
    // — collapsing them onto a single LLM call would leak session A's
    // response to session B's caller. A regression that dropped the
    // sessionId prefix from inflightKey would fail this test.
    const sharedId = MessageId('shared');
    const sessionA = SessionId('session-A');
    const sessionB = SessionId('session-B');

    const aGate = defer<PlannerCandidate>();
    const bGate = defer<PlannerCandidate>();
    const aResponse: PlannerCandidate = {
      ...gridLLMResponse,
      userMessage: 'response for A',
    };
    const bResponse: PlannerCandidate = {
      ...gridLLMResponse,
      userMessage: 'response for B',
    };
    // Each call is routed to the next gate in order — mirrors the two
    // sequential `mockChat.mockImplementationOnce` calls this test used to
    // set up, one per session's leader.
    const gates = [aGate, bGate];
    let index = 0;
    const planner: Planner = async () => {
      const gate = gates[index];
      index += 1;
      if (gate === undefined) throw new Error('planner called more than twice');
      return ok(await gate.promise);
    };

    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();

    const aPromise = engine.handle(
      toChartRequestMessage(request, sessionA, sharedId),
    );
    const bPromise = engine.handle(
      toChartRequestMessage(request, sessionB, sharedId),
    );

    aGate.resolve(aResponse);
    bGate.resolve(bResponse);
    const [a, b] = await Promise.all([aPromise, bPromise]);

    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    if (a.value.type !== 'chart_response' || b.value.type !== 'chart_response')
      return;
    expect(a.value.response.userMessage).toBe('response for A');
    expect(b.value.response.userMessage).toBe('response for B');
    expect(index).toBe(2);
  });

  test('follower with a pre-aborted signal short-circuits to CancellationError without subscribing to the leader', async () => {
    // Exercises the fast-path branch in awaitWithSignal that returns
    // CancellationError synchronously when the follower's signal is already
    // aborted at the time the in-flight check fires. Catches a regression
    // where the fast-path is removed and the follower observes the
    // leader's eventual Ok value instead of its own pre-existing
    // CancellationError.
    const gate = defer<PlannerCandidate>();
    const { planner: blocking, entered } = blockingPlanner(gate);
    const { planner, calls } = countingPlanner(blocking);

    const { engine } = setupIdempotencyEngine(planner);
    const request = makeGridRequest();
    const leader = engine.handle(toChartRequestMessage(request));
    await entered;

    const followerAbort = new AbortController();
    followerAbort.abort('follower never wanted to wait');
    const followerResult = await engine.handle(
      toChartRequestMessage(request),
      followerAbort.signal,
    );

    expect(isErr(followerResult)).toBe(true);
    if (!isErr(followerResult)) return;
    expect(followerResult.error._tag).toBe('CancellationError');

    gate.resolve(gridLLMResponse);
    const leaderResult = await leader;
    expect(isOk(leaderResult)).toBe(true);
    expect(calls()).toBe(1);
  });

  test('follower arriving in the post-LLM / pre-recordTurn window still hits the in-flight entry', async () => {
    // Pins the documented cleanup-ordering invariant: inflight.delete runs
    // AFTER recordTurn settles. Gates the leader's recordTurn (via
    // store.append) so the leader is between LLM completion and recordTurn
    // resolution when the follower arrives. A regression that moved
    // inflight.delete before recordTurn would let the follower miss both
    // layers (cache: not yet written; in-flight: already deleted) and
    // start a duplicate LLM call.
    const appendCalled = defer<void>();
    const appendGate = defer<void>();
    const inner = createInMemoryStore();
    const wrappedStore: HistoryStore = {
      ...inner,
      async append(sessionId, entry) {
        appendCalled.resolve();
        await appendGate.promise;
        return inner.append(sessionId, entry);
      },
    };
    const { planner, calls } = countingPlanner(scriptedPlanner([gridLLMResponse]));

    const { engine } = setupIdempotencyEngine(planner, { store: wrappedStore });
    const request = makeGridRequest();

    const leader = engine.handle(toChartRequestMessage(request));
    // Wait until the leader is parked inside recordTurn's append — i.e.
    // the LLM has already returned but the store write hasn't completed.
    await appendCalled.promise;
    const follower = engine.handle(toChartRequestMessage(request));

    appendGate.resolve();
    const [a, b] = await Promise.all([leader, follower]);

    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(b.value).toEqual(a.value);
    expect(calls()).toBe(1);
  });

  test('recordTurn failing during the in-flight window still serves both leader and follower', async () => {
    // The advisory-write contract: a recordTurn failure must not surface
    // to the caller — the user already has their response. Concurrently:
    // a follower awaiting the leader's promise must observe the same Ok
    // value the leader sees. Together: a recordTurn throw mid-window
    // produces Ok for both, never an asymmetric Ok/Err pair.
    const appendCalled = defer<void>();
    const inner = createInMemoryStore();
    const wrappedStore: HistoryStore = {
      ...inner,
      async append() {
        appendCalled.resolve();
        throw new Error('store write blew up');
      },
    };
    const { planner, calls } = countingPlanner(scriptedPlanner([gridLLMResponse]));

    const { engine } = setupIdempotencyEngine(planner, { store: wrappedStore });
    const request = makeGridRequest();

    const leader = engine.handle(toChartRequestMessage(request));
    await appendCalled.promise;
    const follower = engine.handle(toChartRequestMessage(request));

    const [a, b] = await Promise.all([leader, follower]);

    expect(isOk(a)).toBe(true);
    expect(isOk(b)).toBe(true);
    if (!isOk(a) || !isOk(b)) return;
    expect(b.value).toEqual(a.value);
    expect(calls()).toBe(1);
  });

  test('chart_request whose id collides with a prior injection processes fresh, warns, and does not record', async () => {
    // Edge case the spec calls out as "we do not make it worse": a prior
    // injection occupying a MessageId slot makes getResponseById return
    // `{ kind: 'kind-mismatch', slotKind: 'injection' }` — engine
    // reprocesses, recordTurn's append returns inserted=false (existing
    // dedup), and the consumer (this module) emits the kind-mismatch
    // warning. Captures the warn directly so a regression that drops the
    // logger.warn call regresses observability silently otherwise.
    const { planner, calls } = countingPlanner(
      scriptedPlanner([gridLLMResponse, gridLLMResponse]),
    );

    const { logger, logs } = captureLogger();
    const { engine, store } = setupIdempotencyEngine(planner, { logger });
    const sessionId = SessionId('shared-slot-session');
    const sharedId = MessageId('collide');
    await engine.handle(
      AssistantInjectionMessage({
        sessionId,
        content: 'prior injection',
        id: sharedId,
      }),
    );

    const first = await engine.handle(
      toChartRequestMessage(makeGridRequest(), sessionId, sharedId),
    );
    expect(isOk(first)).toBe(true);
    expect(calls()).toBe(1);

    // A subsequent duplicate also misses both layers — the injection
    // permanently occupies the id slot, so cache replay stays a miss.
    const second = await engine.handle(
      toChartRequestMessage(makeGridRequest(), sessionId, sharedId),
    );
    expect(isOk(second)).toBe(true);
    expect(calls()).toBe(2);

    // Store still holds exactly one entry (the injection); the chart
    // turns never persisted because append's existing-id dedup returned
    // inserted=false.
    const entries = await store.get(sessionId);
    expect(entries.length).toBe(1);
    expect(entries[0]?.kind).toBe('injection');

    // Both chart_request lookups must have emitted the kind-mismatch warn
    // with structured data — `slotKind` carries the actual stored kind so
    // future third entry kinds don't quietly misattribute.
    const kindMismatchWarns = logs.filter(
      (l) => l.level === 'warn' && l.message.includes('reuses a non-turn slot'),
    );
    expect(kindMismatchWarns).toHaveLength(2);
    expect(kindMismatchWarns[0]?.data).toEqual({
      op: 'get_response_by_id',
      outcome: 'kind-mismatch',
      messageId: sharedId,
      sessionId,
      slotKind: 'injection',
    });
  });

  test('getResponseById throwing falls through to a fresh LLM call and logs op:get_response_by_id', async () => {
    // The advisory-read contract: a failed cache lookup must NOT propagate
    // as an Err to the caller. The catch swallows the throw, logs it with
    // the structured op-tag, and falls through to the in-flight + leader
    // path — the user still gets their response. A regression that
    // re-tagged the catch as `return err(...)` would silently fail every
    // chart_request whose store hiccupped on the read path.
    const { planner, calls } = countingPlanner(scriptedPlanner([gridLLMResponse]));
    const cause = new Error('lookup blew up');
    const wrappedStore: HistoryStore = {
      ...createInMemoryStore(),
      async getResponseById() {
        throw cause;
      },
    };

    const { logger, logs } = captureLogger();
    const { engine } = setupIdempotencyEngine(planner, {
      store: wrappedStore,
      logger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);
    expect(calls()).toBe(1);

    const lookupErrors = logs.filter(
      (l) =>
        l.level === 'error' &&
        l.message === 'Failed to look up cached response',
    );
    expect(lookupErrors).toHaveLength(1);
    expect(lookupErrors[0]?.error).toBe(cause);
    expect(lookupErrors[0]?.data).toEqual({
      op: 'get_response_by_id',
      messageId: DEFAULT_MESSAGE_ID,
      sessionId: DEFAULT_SESSION_ID,
    });
  });

  test('recordTurn throwing still serves the caller Ok and logs op:record_turn', async () => {
    // Companion to the in-flight-window test below, but at the simpler
    // sequential level: pins that recordTurn's advisory-write contract
    // doesn't surface to the caller AND that the catch logs the op-tag so
    // a remote-store outage is greppable in operator logs.
    const cause = new Error('store write blew up');
    const wrappedStore: HistoryStore = {
      ...createInMemoryStore(),
      async append() {
        throw cause;
      },
    };
    const planner = scriptedPlanner([gridLLMResponse]);

    const { logger, logs } = captureLogger();
    const { engine } = setupIdempotencyEngine(planner, {
      store: wrappedStore,
      logger,
    });

    const result = await engine.handle(
      toChartRequestMessage(makeGridRequest()),
    );

    expect(isOk(result)).toBe(true);

    const recordErrors = logs.filter(
      (l) => l.level === 'error' && l.message === 'Failed to record turn',
    );
    expect(recordErrors).toHaveLength(1);
    expect(recordErrors[0]?.error).toBe(cause);
    expect(recordErrors[0]?.data).toEqual({
      op: 'record_turn',
      messageId: DEFAULT_MESSAGE_ID,
      sessionId: DEFAULT_SESSION_ID,
    });
  });
});

describe('createChartRequestDedup — defensive paths', () => {
  // The leader-pipeline catch in awaitWithSignal only fires when the leader's
  // promise REJECTS (not Result-typed Err). engine.ts's pipeline is
  // exhaustively try/catched so rejection is unreachable through the public
  // API — this direct-dedup test injects a throwing runChartRequest to pin
  // that the defensive net is wired.
  test('rejecting leader promise surfaces leader_pipeline HistoryError to followers and logs', async () => {
    const cause = new Error('pipeline invariant violated');
    // Gate the rejection so the follower has a deterministic window to
    // attach via awaitWithSignal before the leader settles.
    const rejectionGate = defer<void>();
    // Gate the lookup so we observe an event (lookup-entered) instead of
    // guessing a microtask count to wait for `inflight.set`. Same pattern
    // the rest of this file uses (see `llmCalled` rationale at line 165).
    const lookupEntered = defer<void>();
    const lookupGate = defer<void>();
    // The `Pick<HistoryManager, 'getResponseById' | 'recordTurn'>` typing of
    // ChartRequestDedupDeps.history (see chart-request-dedup.ts) lets a
    // structural literal satisfy the contract without `as unknown as`.
    const history: DedupHistoryBinding = {
      async getResponseById() {
        lookupEntered.resolve();
        await lookupGate.promise;
        return { kind: 'miss' };
      },
      async recordTurn() {
        return undefined;
      },
    };

    const { logger, logs } = captureLogger();
    const dedup = createChartRequestDedup({
      runChartRequest: async () => {
        await rejectionGate.promise;
        throw cause;
      },
      history,
      logger,
    });

    const message = toChartRequestMessage(makeGridRequest());
    const leader = dedup.handle(message);
    // Wait until the leader has entered getResponseById, then release the
    // lookup so handle() proceeds to inflight.set BEFORE the follower runs.
    await lookupEntered.promise;
    lookupGate.resolve();
    // One microtask flush after releasing the gate so the leader's
    // post-await body (including inflight.set) runs before the follower.
    await Promise.resolve();
    // Follower must pass a non-undefined AbortSignal — the `signal ===
    // undefined` short-circuit in awaitWithSignal returns the raw leader
    // promise (which would just propagate the rejection unmapped). The
    // defensive catch only fires inside the `new Promise(...)` branch.
    const followerSignal = new AbortController().signal;
    const follower = dedup.handle(message, followerSignal);

    rejectionGate.resolve();
    const [leaderResult, followerResult] = await Promise.allSettled([
      leader,
      follower,
    ]);

    // Leader's own promise rejects — direct callers see the rejection
    // (engine.ts's wrapping prevents this in production; here we exercise
    // the defensive path that protects followers).
    expect(leaderResult.status).toBe('rejected');

    // Follower observes the rejection via the shared in-flight promise and
    // receives a Result-typed Err carrying the leader_pipeline tag.
    expect(followerResult.status).toBe('fulfilled');
    if (followerResult.status === 'fulfilled' && isErr(followerResult.value)) {
      // Compare structural fields only — `stack` is captured at construction
      // and naturally differs across call sites.
      expect(followerResult.value.error._tag).toBe('HistoryError');
      if (followerResult.value.error._tag === 'HistoryError') {
        expect(followerResult.value.error.operation).toBe('leader_pipeline');
        expect(followerResult.value.error.cause).toBe(cause);
      }
    }

    // Pin the structured data slot — without this, a regression that drops
    // `op: 'leader_pipeline'` (or any of the correlation fields) passes CI
    // because the surrounding assertions don't touch the data shape.
    const leaderLogs = logs.filter(
      (l) =>
        l.level === 'error' &&
        l.message === 'Leader promise rejected unexpectedly',
    );
    expect(leaderLogs).toHaveLength(1);
    expect(leaderLogs[0]?.error).toBe(cause);
    expect(leaderLogs[0]?.data).toEqual({
      op: 'leader_pipeline',
      sessionId: DEFAULT_SESSION_ID,
      messageId: DEFAULT_MESSAGE_ID,
    });
  });
});
