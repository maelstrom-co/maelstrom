/**
 * Reproduction harness for content mutations emitted on resize-only turns.
 *
 * The defect is a model judgment, not a code path: on a `chart_resize`-only
 * turn the Engine sometimes re-emits an Action it already ran, duplicating its
 * effect. It cannot be reproduced on demand, only measured as a rate.
 *
 * Each trial seeds a history store with one synthetic prior turn (a user
 * intent that added a task), optionally followed by a run of bare
 * `chart_resize`-only turns (no paired user message, to match how the real
 * history records a resize-triggered turn), then sends a final resize-only
 * request and records what the model proposed.
 *
 * "The model returned an action" is not the defect signal. A resize-only turn
 * may legitimately return an idempotent variant transition, and the prompt
 * invites exactly that, so counting any surviving action scores correct
 * behaviour as a reproduction. Only a replay of the seeded action counts, and
 * `isSeededReplay` owns that decision.
 *
 * The replay can land on either side of the Engine's guard, so both are read.
 * The surviving `executionPlan` comes back from `handle()` with params
 * intact. A refused action never reaches the caller: the Engine strips
 * `diagnostics` at its boundary and reports each refusal on the "Response
 * healed" log line, so this harness injects a custom `Logger` and reads the
 * refusals off that line's `detail.skips`. Per trial it records:
 *   - `survived`: the seeded replay reached the client (guard let it past)
 *   - `refused`: the seeded replay was refused (guard held)
 *   - `other`: every action that is not the seeded replay, printed but never
 *     counted toward the headline rate
 * The headline rate is `survived || refused` over N. Reported apart, the two
 * distinguish "model emitted nothing" (prompt fix worked) from "model
 * emitted, guard dropped it" (guard worked).
 *
 * One LLM call per trial.
 *
 * Run (named flags, required to reach the sweep knobs):
 *   OPENAI_API_KEY=sk-... bun --conditions=@maelstrom-co/source \
 *     run scripts/eval-resize-replay.ts \
 *     --trials=30 --prior-message='Added "Buy milk" to your task list.' \
 *     --prior-intent='add a task to buy milk' --resize-to=7x11 --intervening=0
 *
 * Run against Gemini instead of OpenAI (`--provider` defaults to `openai`,
 * and each provider carries its own default model that `ENGINE_MODEL`
 * overrides):
 *   GOOGLE_API_KEY=... bun --conditions=@maelstrom-co/source \
 *     run scripts/eval-resize-replay.ts --provider=gemini --trials=30
 *
 * `--conditions=@maelstrom-co/source` is required: without it
 * `@maelstrom-co/engine` resolves to a `dist/` that does not exist in an
 * unbuilt worktree.
 *
 * SIGINT/SIGTERM print a PARTIAL summary over whatever trials completed and
 * exit; an uninterrupted run prints the same summary format once at the end,
 * labeled FINAL.
 *
 * Exits non-zero when any trial replayed the seeded action, when any trial
 * errored, or when no trial completed. Actions that are not the seeded replay
 * are printed and never affect the exit code.
 */
import {
  createEngine,
  createInMemoryStore,
  type Logger,
} from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';
import { createGeminiChat, type GeminiTextModel } from '@tanstack/ai-gemini';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import { calendarVessel } from '../src/vessels/calendar.vessel.def';
import { journalVessel } from '../src/vessels/journal.vessel.def';
import { mapVessel } from '../src/vessels/map.vessel.def';
import { tasksVessel } from '../src/vessels/tasks.vessel.def';
import { weatherVessel } from '../src/vessels/weather.vessel.def';
import type { RefusedAction, TrialObservation } from './resize-replay-verdict';
import { SEEDED_ACTION, scoreTrial } from './resize-replay-verdict';

/**
 * The reported hit rates were measured on `gpt-4o-mini` (openai) and
 * `gemini-3.1-flash-lite-preview` (gemini). These are deliberately weak
 * models: stronger models rarely emit resize-only mutations, so they mask the
 * defect and produce a green run that proves nothing. The demo's own
 * shipping default is `gpt-5.6-luna` (see
 * apps/demo/src/server/engine-model.ts); the mismatch is intentional.
 */
const DEFAULT_MODELS: { openai: OpenAIChatModel; gemini: GeminiTextModel } = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.1-flash-lite-preview',
};

const config = parseArgs(process.argv.slice(2));

const apiKey = requireApiKey(config.provider);

const model: string =
  nonEmptyEnv('ENGINE_MODEL') ?? DEFAULT_MODELS[config.provider];

/**
 * Mirrors `createPlaygroundEngine` (apps/demo/src/server/engine-config.ts).
 * Inlined rather than reused because that factory owns its history store, and
 * this harness must seed one. Keep in sync: an eval running a different config
 * measures a different system.
 */
const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

const instances = [
  { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
];
const vessels = [
  tasksVessel,
  calendarVessel,
  weatherVessel,
  journalVessel,
  mapVessel,
];
const layout = { type: 'tiling' as const, tree: ['ID:tasks-main'], instances };

const PRIOR_CHART_DIMENSIONS = { columns: 12, rows: 8 };

function priorTurn(sessionId: string) {
  return {
    kind: 'turn' as const,
    input: {
      type: 'chart_request' as const,
      sessionId,
      id: 'req-prior',
      timestamp: Date.now() - 60_000,
      request: {
        type: 'chart_request' as const,
        context: {
          updateReasons: [{ type: 'user_intent', intent: config.priorIntent }],
          chartDimensions: PRIOR_CHART_DIMENSIONS,
          layoutMode: 'tiling' as const,
        },
        instances,
        vessels,
        layout,
      },
    },
    output: {
      type: 'chart_response' as const,
      sessionId,
      id: 'req-prior',
      response: {
        type: 'maelstrom_response' as const,
        requestId: 'req-prior',
        userMessage: config.priorMessage,
        rationale: 'User asked to add a task.',
        executionPlan: [SEEDED_ACTION],
        layout,
      },
    },
  };
}

/**
 * A bare `chart_resize`-only turn: no paired user message, mirroring how
 * `extractUserIntent` (packages/engine/src/lib/history/history-manager.ts)
 * yields nothing when `updateReasons` carries only a resize. Used to seed a
 * run of unpaired assistant turns ahead of the final resize request.
 */
function interveningResizeTurn(
  sessionId: string,
  index: number,
  previous: ChartDims,
  current: ChartDims,
) {
  const id = `req-resize-${index}`;
  return {
    kind: 'turn' as const,
    input: {
      type: 'chart_request' as const,
      sessionId,
      id,
      timestamp: Date.now() - 30_000 + index,
      request: {
        type: 'chart_request' as const,
        context: {
          updateReasons: [{ type: 'chart_resize' as const, previous, current }],
          chartDimensions: current,
          layoutMode: 'tiling' as const,
        },
        instances,
        vessels,
        layout,
      },
    },
    output: {
      type: 'chart_response' as const,
      sessionId,
      id,
      response: {
        type: 'maelstrom_response' as const,
        requestId: id,
        userMessage: 'Adjusted the layout for the new chart size.',
        rationale: 'Chart was resized; no content change needed.',
        executionPlan: [],
        layout,
      },
    },
  };
}

function resizeRequest(
  sessionId: string,
  previous: ChartDims,
  current: ChartDims,
) {
  return {
    type: 'chart_request' as const,
    sessionId,
    id: 'req-resize',
    timestamp: Date.now(),
    request: {
      type: 'chart_request' as const,
      context: {
        updateReasons: [{ type: 'chart_resize' as const, previous, current }],
        chartDimensions: current,
        layoutMode: 'tiling' as const,
      },
      instances,
      vessels,
      layout,
    },
  };
}

function createDiagnosticsLogger(): {
  logger: Logger;
  refusedActions: () => readonly RefusedAction[];
} {
  let refused: readonly RefusedAction[] = [];
  const capture = (message: string, data?: Record<string, unknown>) => {
    if (message !== 'Response healed') return;
    refused = readRefusals(data);
  };
  return {
    logger: {
      debug: () => {},
      info: capture,
      warn: capture,
      error: (message, _error, data) => capture(message, data),
    },
    refusedActions: () => refused,
  };
}

let hits = 0;
let survivedHits = 0;
let refusedHits = 0;
let otherTrials = 0;
let errors = 0;
let completed = 0;

function printSummary(final: boolean): void {
  const label = final ? 'FINAL' : 'PARTIAL';
  const rate = ((hits / Math.max(completed, 1)) * 100).toFixed(1);
  console.log(
    `\n[${label}] provider=${config.provider} model=${model} ` +
      `N=${config.trials} hits=${hits} rate=${rate}% ` +
      `completed=${completed} survived=${survivedHits} refused=${refusedHits} ` +
      `other=${otherTrials} errors=${errors}`,
  );
  if (errors === completed && completed > 0) {
    console.error(
      `[${label}] every trial errored (${errors}/${completed}); this run measured nothing`,
    );
  } else if (errors > 0) {
    console.error(
      `[${label}] ${errors} trial(s) errored; the hit rate above excludes them`,
    );
  }
}

function printConfig(): void {
  console.log(
    [
      `provider=${config.provider}`,
      `model=${model}`,
      `trials=${config.trials}`,
      `priorMessage=${JSON.stringify(config.priorMessage)}`,
      `priorIntent=${JSON.stringify(config.priorIntent)}`,
      `resize=${PRIOR_CHART_DIMENSIONS.columns}x${PRIOR_CHART_DIMENSIONS.rows}->${config.resizeTo.columns}x${config.resizeTo.rows}`,
      `intervening=${config.intervening}`,
      `vessels=${vessels.length}`,
    ].join(' '),
  );
}

let interrupted = false;
function onInterrupt(signal: string): void {
  if (interrupted) return;
  interrupted = true;
  console.log(`\nreceived ${signal}, printing partial results`);
  printSummary(false);
  process.exit(runFailed() ? 1 : 0);
}
process.on('SIGINT', () => onInterrupt('SIGINT'));
process.on('SIGTERM', () => onInterrupt('SIGTERM'));

printConfig();

for (let trial = 0; trial < config.trials; trial += 1) {
  const sessionId = `eval-${Date.now()}-${trial}`;
  const store = createInMemoryStore();
  const { logger, refusedActions } = createDiagnosticsLogger();

  // Branded ids and schema-validated payloads are enforced at the wire
  // boundary; this harness constructs both by hand on purpose.
  await store.append(sessionId as never, priorTurn(sessionId) as never);

  const waypoints = interveningWaypoints(
    config.intervening,
    PRIOR_CHART_DIMENSIONS,
    config.resizeTo,
  );
  let lastDims: ChartDims = PRIOR_CHART_DIMENSIONS;
  for (let i = 0; i < config.intervening; i += 1) {
    const current = waypoints[i] as ChartDims;
    await store.append(
      sessionId as never,
      interveningResizeTurn(sessionId, i, lastDims, current) as never,
    );
    lastDims = current;
  }

  const engine = createEngine({
    adapter: createAdapter(),
    maxRetries: 2,
    history: { store, maxEntries: 20 },
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
    logger,
  });

  const result = await engine.handle(
    resizeRequest(sessionId, lastDims, config.resizeTo) as never,
  );

  completed += 1;

  if (!result.ok) {
    errors += 1;
    console.log(
      `${trial} ERR ${result.error._tag} | tally hits=${hits}/${completed}`,
    );
    continue;
  }

  const observation: TrialObservation = {
    plan:
      result.value.type === 'chart_response'
        ? result.value.response.executionPlan
        : [],
    refused: refusedActions(),
  };
  const verdict = scoreTrial(observation);

  if (verdict.survived) survivedHits += 1;
  if (verdict.refused) refusedHits += 1;
  if (verdict.otherActions.length > 0) otherTrials += 1;

  const other =
    verdict.otherActions.length > 0
      ? ` other=[${verdict.otherActions.join(', ')}]`
      : '';
  if (verdict.replayed) {
    hits += 1;
    console.log(
      `${trial} HIT survived=${verdict.survived} refused=${verdict.refused}` +
        `${other} | tally hits=${hits}/${completed}`,
    );
  } else {
    console.log(
      `${trial} ok no replay${other} | tally hits=${hits}/${completed}`,
    );
  }
}

printSummary(true);

process.exit(runFailed() ? 1 : 0);

interface ChartDims {
  readonly columns: number;
  readonly rows: number;
}

type Provider = 'openai' | 'gemini';

interface HarnessConfig {
  readonly provider: Provider;
  readonly trials: number;
  readonly priorMessage: string;
  readonly priorIntent: string;
  readonly resizeTo: ChartDims;
  readonly intervening: number;
}

/**
 * Chains `count` distinct resize waypoints from `start`, none equal to
 * `final`, so the measured turn's `previous` (the last waypoint, or `start`
 * when `count` is 0) never equals its `current` (`final`).
 */
function interveningWaypoints(
  count: number,
  start: ChartDims,
  final: ChartDims,
): ChartDims[] {
  const waypoints: ChartDims[] = [];
  for (let i = 0; i < count; i += 1) {
    let candidate: ChartDims = {
      columns: start.columns + i + 1,
      rows: start.rows + i + 1,
    };
    if (dimsEqual(candidate, final)) {
      candidate = { columns: candidate.columns + 1, rows: candidate.rows + 1 };
    }
    waypoints.push(candidate);
  }
  return waypoints;
}

function dimsEqual(a: ChartDims, b: ChartDims): boolean {
  return a.columns === b.columns && a.rows === b.rows;
}

/**
 * Only a seeded replay, a trial error, or an empty run fails the script. An
 * action that is not the replay is reported and deliberately ignored: the
 * resize instruction invites idempotent transitions, so failing on those
 * would exit non-zero on correct Engine behaviour.
 */
function runFailed(): boolean {
  return hits > 0 || errors > 0 || completed === 0;
}

/**
 * Reads the refused actions off a "Response healed" log entry. Missing or
 * unrecognised shapes yield nothing rather than throwing: the log's contract
 * is pinned by an Engine test, and a harness that dies here would report a
 * measurement failure as a trial error.
 */
function readRefusals(
  data?: Record<string, unknown>,
): readonly RefusedAction[] {
  const detail = data?.detail;
  if (typeof detail !== 'object' || detail === null) return [];
  const skips = (detail as { skips?: unknown }).skips;
  if (!Array.isArray(skips)) return [];
  return skips.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { reason, instanceId, action, vesselId } = entry as Record<
      string,
      unknown
    >;
    if (typeof reason !== 'string') return [];
    return [
      {
        reason,
        ...(typeof instanceId === 'string' ? { instanceId } : {}),
        ...(typeof action === 'string' ? { action } : {}),
        ...(typeof vesselId === 'string' ? { vesselId } : {}),
      },
    ];
  });
}

function parseProvider(value: string): Provider {
  if (value === 'openai' || value === 'gemini') return value;
  console.error(
    `invalid --provider value ${JSON.stringify(value)}, expected openai or gemini`,
  );
  process.exit(1);
}

function requireApiKey(provider: Provider): string {
  if (provider === 'gemini') {
    const key = nonEmptyEnv('GOOGLE_API_KEY') ?? nonEmptyEnv('GEMINI_API_KEY');
    if (key) return key;
    console.error(
      'GOOGLE_API_KEY (or GEMINI_API_KEY) required for --provider=gemini',
    );
    process.exit(1);
  }
  const key = nonEmptyEnv('OPENAI_API_KEY');
  if (key) return key;
  console.error('OPENAI_API_KEY required');
  process.exit(1);
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function createAdapter(): AnyTextAdapter {
  return config.provider === 'gemini'
    ? createGeminiChat(model as GeminiTextModel, apiKey)
    : createOpenaiChat(model as OpenAIChatModel, apiKey);
}

function parseDims(spec: string, flagName: string): ChartDims {
  const match = /^(\d+)x(\d+)$/.exec(spec.trim());
  if (!match) {
    console.error(
      `invalid ${flagName} value ${JSON.stringify(spec)}, expected COLUMNSxROWS e.g. 7x11`,
    );
    process.exit(1);
  }
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

function requirePositiveInt(raw: string, flagName: string): number {
  return requireIntWithMin(raw, flagName, 1);
}

function requireNonNegativeInt(raw: string, flagName: string): number {
  return requireIntWithMin(raw, flagName, 0);
}

function requireIntWithMin(raw: string, flagName: string, min: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    console.error(
      `invalid ${flagName} value ${JSON.stringify(raw)}, expected an integer >= ${min}`,
    );
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: readonly string[]): HarnessConfig {
  const defaults: HarnessConfig = {
    provider: 'openai',
    trials: 30,
    priorMessage: 'Added "Buy milk" to your task list.',
    priorIntent: 'add a task to buy milk',
    resizeTo: { columns: 7, rows: 11 },
    intervening: 0,
  };

  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) {
      console.error(`flag ${arg} needs a value, e.g. ${arg}=value`);
      process.exit(1);
    }
    flags.set(arg.slice(2, eq), arg.slice(eq + 1));
  }

  return {
    provider: flags.has('provider')
      ? parseProvider(flags.get('provider') as string)
      : defaults.provider,
    trials: flags.has('trials')
      ? requirePositiveInt(flags.get('trials') as string, '--trials')
      : defaults.trials,
    priorMessage: flags.get('prior-message') ?? defaults.priorMessage,
    priorIntent: flags.get('prior-intent') ?? defaults.priorIntent,
    resizeTo: flags.has('resize-to')
      ? parseDims(flags.get('resize-to') as string, '--resize-to')
      : defaults.resizeTo,
    intervening: flags.has('intervening')
      ? requireNonNegativeInt(
          flags.get('intervening') as string,
          '--intervening',
        )
      : defaults.intervening,
  };
}
