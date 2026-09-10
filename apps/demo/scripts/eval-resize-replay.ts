/**
 * Reproduction harness for content mutations emitted on resize-only turns.
 *
 * The defect is a model judgment, not a code path: on a `chart_resize`-only
 * turn the Engine sometimes re-emits an Action it already ran, duplicating its
 * effect. It cannot be reproduced on demand, only measured as a rate.
 *
 * Each trial seeds a history store with one synthetic prior turn (a user
 * intent that ran one content mutation), optionally followed by a run of bare
 * `chart_resize`-only turns (no paired user message, to match how the real
 * history records a resize-triggered turn), then sends a final resize-only
 * request and records what the model proposed.
 *
 * `--seed` chooses which mutation the prior turn ran: `tasks-add-task` (the
 * default), `journal-create-entry`, or `calendar-add-event`. The latter two
 * name an action that also transitions the instance's Variant, which is the
 * combination an earlier draft of the guard mishandled by reading
 * `transitionsTo` as evidence that an action was safe to re-run. `--mounted`
 * (1 to 5, default 1) says how many Vessel instances the chart already
 * carries; every Vessel is offered to the model either way.
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
 * The headline rate is `survived || refused` over the trials that completed
 * without erroring, and reads `n/a` when none did. Reported apart, the two
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
 * Seed a mutation that also transitions a Variant, on a chart with all five
 * demo Vessels mounted:
 *   GOOGLE_API_KEY=... bun --conditions=@maelstrom-co/source \
 *     run scripts/eval-resize-replay.ts --provider=gemini \
 *     --seed=journal-create-entry --mounted=5
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
  type HistoryEntry,
  type Logger,
} from '@maelstrom-co/engine';
import {
  ActionName,
  InstanceId,
  MessageId,
  SessionId,
  TILING_LEAF_PREFIX,
  type TilingLayout,
  type TilingNode,
  VariantName,
  type Vessel,
  type VesselDefinition,
  VesselId,
  type VesselInstanceSnapshot,
  validateVessel,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { createGeminiChat, type GeminiTextModel } from '@tanstack/ai-gemini';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import { calendarVessel } from '../src/vessels/calendar.vessel.def';
import { journalVessel } from '../src/vessels/journal.vessel.def';
import { mapVessel } from '../src/vessels/map.vessel.def';
import { tasksVessel } from '../src/vessels/tasks.vessel.def';
import { weatherVessel } from '../src/vessels/weather.vessel.def';
import { formatHitRate, TRIAL_MAX_RETRIES } from './resize-replay-run';
import type {
  RefusedAction,
  SeededAction,
  TrialObservation,
} from './resize-replay-verdict';
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

/**
 * Branded through the same validation a Vessel passes on the client before it
 * reaches the Engine, so this harness measures the roster the demo sends
 * rather than the author-facing definitions behind it.
 */
const vessels: readonly Vessel[] = [
  tasksVessel,
  calendarVessel,
  weatherVessel,
  journalVessel,
  mapVessel,
].map(brandVessel);

function brandVessel(definition: VesselDefinition): Vessel {
  const result = validateVessel(definition);
  if (result.valid) return result.vessel;
  console.error(
    `vessel ${definition.id} failed validation: ${result.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')}`,
  );
  process.exit(1);
}

/**
 * The mutation each seed puts in the prior turn, and the Variant it ran from.
 *
 * `instance.variant` must be a Variant on which the seeded action carries no
 * `transitionsTo`. The measured resize turn mounts the instance on that same
 * Variant, so the conversation never needs a turn walking the instance back
 * from somewhere else — the mutation stays the turn immediately before the
 * resize. A seed whose only available Variant transitions on that action would
 * bury the mutation behind a navigational turn instead, diluting the probe.
 */
const SEED_SCENARIOS: Record<SeedId, SeedScenario> = {
  'tasks-add-task': {
    instance: {
      instanceId: InstanceId('tasks-main'),
      vesselId: VesselId('tasks'),
      variant: VariantName('list'),
    },
    seed: SEEDED_ACTION,
    priorIntent: 'add a task to buy milk',
    priorMessage: 'Added "Buy milk" to your task list.',
    priorRationale: 'User asked to add a task.',
  },
  'journal-create-entry': {
    instance: {
      instanceId: InstanceId('journal-main'),
      vesselId: VesselId('journal'),
      variant: VariantName('entry'),
    },
    seed: {
      instanceId: 'journal-main',
      action: 'createEntry',
      params: { title: 'Morning pages' },
    },
    priorIntent: 'start a new journal entry called Morning pages',
    priorMessage: 'Created "Morning pages" and opened it for writing.',
    priorRationale:
      'User asked to start a new entry while an entry was already open.',
  },
  'calendar-add-event': {
    instance: {
      instanceId: InstanceId('calendar-main'),
      vesselId: VesselId('calendar'),
      variant: VariantName('day'),
    },
    seed: {
      instanceId: 'calendar-main',
      action: 'addEvent',
      params: { title: 'Dentist', time: '15:00' },
    },
    priorIntent: 'put a dentist appointment at 15:00 on today',
    priorMessage: 'Added "Dentist" at 15:00 to today\'s schedule.',
    priorRationale:
      'User asked to schedule an event while already viewing the day.',
  },
};

const config = parseArgs(process.argv.slice(2));

const scenario = SEED_SCENARIOS[config.seed];

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

/**
 * Every Vessel stays available to the model; `--mounted` only decides how many
 * of them the chart already carries. The seeded Vessel is always mounted, so
 * the roster supplies the rest in this order.
 */
const MOUNT_ORDER = vessels.filter(
  (vessel) => vessel.id !== scenario.instance.vesselId,
);

const sourceChart = chartAt(scenario.instance.variant);

const PRIOR_CHART_DIMENSIONS = { columns: 12, rows: 8 };

/** Mounts the seeded instance on `variant`, plus `--mounted - 1` others. */
function chartAt(variant: VariantName): Chart {
  const instances: readonly VesselInstanceSnapshot[] = [
    { ...scenario.instance, variant },
    ...MOUNT_ORDER.slice(0, config.mounted - 1).map((vessel) => ({
      instanceId: InstanceId(`${vessel.id}-main`),
      vesselId: vessel.id,
      variant: vessel.defaultVariant,
    })),
  ];
  const tree = subtree(
    instances.map((instance) => instance.instanceId),
    'V',
  );
  return { instances, layout: { type: 'tiling', tree, instances } };
}

// Halving alternately down each axis keeps every tile a usable shape, which a
// single split of five would not.
function subtree(ids: readonly InstanceId[], axis: 'V' | 'H'): TilingNode[] {
  if (ids.length <= 1) return [`${TILING_LEAF_PREFIX}${ids[0]}`];
  const half = Math.ceil(ids.length / 2);
  const inner = axis === 'V' ? 'H' : 'V';
  return [
    axis,
    ...subtree(ids.slice(0, half), inner),
    ...subtree(ids.slice(half), inner),
  ];
}

function priorTurn(sessionId: SessionId) {
  const id = MessageId('req-prior');
  return {
    kind: 'turn',
    input: {
      type: 'chart_request',
      sessionId,
      id,
      timestamp: Date.now() - 60_000,
      request: {
        type: 'chart_request',
        context: {
          updateReasons: [{ type: 'user_intent', intent: config.priorIntent }],
          chartDimensions: PRIOR_CHART_DIMENSIONS,
          layoutMode: 'tiling',
        },
        instances: sourceChart.instances,
        vessels,
        layout: sourceChart.layout,
      },
    },
    output: {
      type: 'chart_response',
      sessionId,
      id,
      response: {
        type: 'maelstrom_response',
        requestId: id,
        userMessage: config.priorMessage,
        rationale: scenario.priorRationale,
        executionPlan: [
          {
            instanceId: InstanceId(scenario.seed.instanceId),
            action: ActionName(scenario.seed.action),
            params: { ...scenario.seed.params },
          },
        ],
        layout: sourceChart.layout,
      },
    },
  } satisfies HistoryEntry;
}

/**
 * A bare `chart_resize`-only turn: no paired user message, mirroring how
 * `extractUserIntent` (packages/engine/src/lib/history/history-manager.ts)
 * yields nothing when `updateReasons` carries only a resize. Used to seed a
 * run of unpaired assistant turns ahead of the final resize request.
 */
function interveningResizeTurn(
  sessionId: SessionId,
  index: number,
  previous: ChartDims,
  current: ChartDims,
) {
  const id = MessageId(`req-resize-${index}`);
  return {
    kind: 'turn',
    input: {
      type: 'chart_request',
      sessionId,
      id,
      timestamp: Date.now() - 30_000 + index,
      request: {
        type: 'chart_request',
        context: {
          updateReasons: [{ type: 'chart_resize', previous, current }],
          chartDimensions: current,
          layoutMode: 'tiling',
        },
        instances: sourceChart.instances,
        vessels,
        layout: sourceChart.layout,
      },
    },
    output: {
      type: 'chart_response',
      sessionId,
      id,
      response: {
        type: 'maelstrom_response',
        requestId: id,
        userMessage: 'Adjusted the layout for the new chart size.',
        rationale: 'Chart was resized; no content change needed.',
        executionPlan: [],
        layout: sourceChart.layout,
      },
    },
  } satisfies HistoryEntry;
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
      instances: sourceChart.instances,
      vessels,
      layout: sourceChart.layout,
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
  const rate = formatHitRate({ hits, completed, errors });
  console.log(
    `\n[${label}] provider=${config.provider} model=${model} ` +
      `seed=${config.seed} mounted=${sourceChart.instances.length} ` +
      `N=${config.trials} hits=${hits} rate=${rate} ` +
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
      `seed=${config.seed}`,
      `seededAction=${scenario.seed.instanceId}.${scenario.seed.action}`,
      `mounted=${sourceChart.instances.length}`,
      `variant=${scenario.instance.variant}`,
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
  const sessionId = SessionId(`eval-${Date.now()}-${trial}`);
  const store = createInMemoryStore();
  const { logger, refusedActions } = createDiagnosticsLogger();

  await store.append(sessionId, priorTurn(sessionId));

  const waypoints = interveningWaypoints(
    config.intervening,
    PRIOR_CHART_DIMENSIONS,
    config.resizeTo,
  );
  let lastDims: ChartDims = PRIOR_CHART_DIMENSIONS;
  for (let i = 0; i < config.intervening; i += 1) {
    const current = waypoints[i] as ChartDims;
    await store.append(
      sessionId,
      interveningResizeTurn(sessionId, i, lastDims, current),
    );
    lastDims = current;
  }

  const engine = createEngine({
    adapter: createAdapter(),
    maxRetries: TRIAL_MAX_RETRIES,
    history: { store, maxEntries: 20 },
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
    logger,
  });

  // The measured request is the one payload the Engine validates for itself,
  // so it stays hand-built and unbranded.
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
  const verdict = scoreTrial(observation, scenario.seed);

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

/** Which mutation the prior turn ran, and so which replay scores a hit. */
type SeedId = 'tasks-add-task' | 'journal-create-entry' | 'calendar-add-event';

interface Chart {
  readonly instances: readonly VesselInstanceSnapshot[];
  readonly layout: TilingLayout;
}

interface SeedScenario {
  readonly instance: VesselInstanceSnapshot;
  readonly seed: SeededAction;
  readonly priorIntent: string;
  readonly priorMessage: string;
  readonly priorRationale: string;
}

interface HarnessConfig {
  readonly provider: Provider;
  readonly seed: SeedId;
  readonly mounted: number;
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

function parseSeed(value: string): SeedId {
  if (Object.hasOwn(SEED_SCENARIOS, value)) return value as SeedId;
  console.error(
    `invalid --seed value ${JSON.stringify(value)}, expected one of ${Object.keys(SEED_SCENARIOS).join(', ')}`,
  );
  process.exit(1);
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

function requireMountCount(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > vessels.length) {
    console.error(
      `invalid --mounted value ${JSON.stringify(raw)}, expected an integer from 1 to ${vessels.length}`,
    );
    process.exit(1);
  }
  return value;
}

function parseArgs(argv: readonly string[]): HarnessConfig {
  const defaults = {
    provider: 'openai',
    seed: 'tasks-add-task',
    mounted: 1,
    trials: 30,
    resizeTo: { columns: 7, rows: 11 },
    intervening: 0,
  } as const;

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

  // The seeded conversation has to read as the mutation it seeded, so the
  // prior message and intent default off the seed rather than off the task
  // list every seed used to be.
  const seed = flags.has('seed')
    ? parseSeed(flags.get('seed') as string)
    : defaults.seed;

  return {
    provider: flags.has('provider')
      ? parseProvider(flags.get('provider') as string)
      : defaults.provider,
    seed,
    mounted: flags.has('mounted')
      ? requireMountCount(flags.get('mounted') as string)
      : defaults.mounted,
    trials: flags.has('trials')
      ? requirePositiveInt(flags.get('trials') as string, '--trials')
      : defaults.trials,
    priorMessage:
      flags.get('prior-message') ?? SEED_SCENARIOS[seed].priorMessage,
    priorIntent: flags.get('prior-intent') ?? SEED_SCENARIOS[seed].priorIntent,
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
