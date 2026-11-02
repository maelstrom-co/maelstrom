import { readFileSync } from 'node:fs';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { buildSystemPrompt, llmPlanner } from '@maelstrom-co/planner-llm';
import {
  type ChartRequest,
  ChartRequestMessage,
  isErr,
  type MaelstromResponse,
  MessageId,
  SessionId,
  type Vessel,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import { treeRects } from '../core/geometry.js';
import { checkArrangement } from '../core/predicates.js';
import {
  type EvaluationResult,
  evaluateSample,
  type Verdict,
} from '../core/runtime/evaluate.js';
import { request } from '../core/scenarios.js';
import { type ManualFetch, manualTransport } from './transport.js';

const caseId = 'weather-below-map-small';
const model = 'gpt-6-luna';
const maxOutputTokens = 2048;
const intent = 'Put weather below the map and make it very small';
const maxWeatherShare = 0.15;
const maxWeatherToMapRatio = 0.35;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const usage =
  'Usage: weather-below-map-small.ts [--samples 1..10] [--case <id>] [--live --confirm-capped-key]';

// Measured by the "measures the Chart" test in
// apps/demo/e2e/weather-compact.e2e.ts: `context.chartDimensions` of the first
// chart_request from the hosted build at 1440x900 (desktop) and 390x844 (mobile).
const MEASURED_CHART = {
  desktop: { columns: 18, rows: 7 },
  mobile: { columns: 4, rows: 5 },
} as const;

/** One starting Chart for the request, at one measured Chart size. */
export interface WeatherBelowMapCase {
  readonly id: string;
  readonly start: 'map-open-weather-absent' | 'map-beside-weather';
  readonly columns: number;
  readonly rows: number;
}

/** The start states and Chart sizes this runner samples, in run order. */
export const WEATHER_BELOW_MAP_CASES: readonly WeatherBelowMapCase[] = [
  {
    id: 'desktop-map-open-weather-absent',
    start: 'map-open-weather-absent',
    ...MEASURED_CHART.desktop,
  },
  {
    id: 'desktop-map-beside-weather',
    start: 'map-beside-weather',
    ...MEASURED_CHART.desktop,
  },
  {
    id: 'mobile-map-beside-weather',
    start: 'map-beside-weather',
    ...MEASURED_CHART.mobile,
  },
];

/** What a response did to weather and map, recorded whether or not it passes. */
export interface WeatherBelowMapMeasurements {
  readonly tree: string;
  readonly rects: Readonly<
    Record<
      string,
      { x: number; y: number; width: number; height: number } | undefined
    >
  >;
  readonly weatherInstanceId: string | null;
  readonly weatherShare: number | null;
  readonly mapShare: number | null;
  readonly weatherVariant: string | null;
  readonly weatherActions: readonly string[];
  readonly userMessage: string;
}

/** A {@link Verdict} plus the measurements behind it, absent without a response. */
export interface WeatherBelowMapScore extends Verdict {
  readonly measurements?: WeatherBelowMapMeasurements;
}

/** The Chart request for `entry`, built from the current demo Vessel definitions. */
export async function weatherBelowMapRequest(
  entry: WeatherBelowMapCase,
): Promise<ChartRequest> {
  const vessels = await demoCatalog();
  const bare =
    entry.start === 'map-open-weather-absent'
      ? request(intent, {
          vessels,
          instances: ['calendar', 'tasks', 'map'],
          variants: { calendar: 'day', tasks: 'list', map: 'overview' },
          tree: ['V', 'ID:calendar-main', 'H', 'ID:map-main', 'ID:tasks-main'],
          columns: entry.columns,
          rows: entry.rows,
        })
      : request(intent, {
          vessels,
          instances: ['map', 'weather'],
          variants: { map: 'overview', weather: 'current' },
          tree: ['V', 'ID:map-main', 'ID:weather-main'],
          columns: entry.columns,
          rows: entry.rows,
        });
  // The demo connector appends browser calendar context to every typed intent.
  const calendar = await demoCalendarContext();
  return calendar.withBrowserCalendarContext(
    ChartRequestMessage({
      sessionId: SessionId('calendar-context'),
      id: MessageId('calendar-context'),
      request: bare,
    }),
    calendar.context,
  ).request;
}

/** 0 for a dry run or a live run where every sample completed and passed, else 1. */
export function weatherRunExitCode(
  report: Awaited<ReturnType<typeof runWeatherBelowMapSmall>>,
): 0 | 1 {
  if (report.mode !== 'live') return 0;
  return report.samples.every(
    (sample) =>
      sample.result.completeness === 'complete' &&
      sample.result.evaluation === 'pass',
  )
    ? 0
    : 1;
}

/**
 * Scores the shipped response: weather and map visible, weather below the map,
 * weather at most 15% of the Chart and at most 0.35 of the map's area, and
 * weather compact (shipped in the compact Variant, or a `showCompact` Action on
 * it). The Instances are found by Vessel, since the Planner names an Instance
 * it adds.
 */
export function scoreWeatherBelowMapSmall(
  response: MaelstromResponse | undefined,
  initial: ChartRequest,
): WeatherBelowMapScore {
  if (!response)
    return { outcome: 'fail', failures: ['Missing complete Engine response'] };
  const failures: string[] = [];
  const layout = response.layout;
  const tree = layout.type === 'tiling' ? layout.tree : [];
  const instances = layout.type === 'tiling' ? layout.instances : [];
  if (layout.type !== 'tiling') failures.push('Layout is not tiling');
  const rects = treeRects(initial, tree);
  if (layout.type === 'tiling' && !rects)
    failures.push('Layout tree is malformed');
  const rect = (id: string) => rects?.find((leaf) => leaf.instanceId === id);
  const instanceOf = (vesselId: string) => {
    const candidates = instances.filter(
      (instance) => instance.vesselId === vesselId,
    );
    return (
      candidates.find((instance) => rect(instance.instanceId)) ?? candidates[0]
    );
  };
  const weatherInstance = instanceOf('weather');
  const weatherId = weatherInstance?.instanceId ?? 'weather-main';
  const mapId = instanceOf('map')?.instanceId ?? 'map-main';
  const chartArea =
    initial.context.chartDimensions.columns *
    initial.context.chartDimensions.rows;
  const share = (id: string) => {
    const leaf = rect(id);
    return leaf ? round((leaf.width * leaf.height) / chartArea) : null;
  };
  const measurements: WeatherBelowMapMeasurements = {
    tree: tree.map((token) => token ?? 'null').join(' '),
    rects: Object.fromEntries(
      (rects ?? []).map((leaf) => [
        leaf.instanceId,
        {
          x: round(leaf.x),
          y: round(leaf.y),
          width: round(leaf.width),
          height: round(leaf.height),
        },
      ]),
    ),
    weatherInstanceId: weatherInstance?.instanceId ?? null,
    weatherShare: share(weatherId),
    mapShare: share(mapId),
    weatherVariant: weatherInstance?.variant ?? null,
    weatherActions: response.executionPlan
      .filter(
        (step) =>
          step.instanceId === weatherId && step.action.startsWith('show'),
      )
      .map((step) => step.action),
    userMessage: response.userMessage,
  };
  const visible = [mapId, weatherId].filter((id) => {
    const shown =
      rect(id) !== undefined &&
      instances.some((instance) => instance.instanceId === id);
    if (!shown) failures.push(`${id} is not visible`);
    return shown;
  });
  if (visible.length === 2) {
    const arranged = { request: initial, tree };
    const [below, ratio] = [
      checkArrangement([{ kind: 'below', a: weatherId, b: mapId }], arranged),
      checkArrangement(
        [
          {
            kind: 'weightRatio',
            a: weatherId,
            b: mapId,
            min: 0,
            max: maxWeatherToMapRatio,
          },
        ],
        arranged,
      ),
    ];
    failures.push(...below.failures);
    if ((measurements.weatherShare ?? 1) > maxWeatherShare)
      failures.push(
        `weather share ${measurements.weatherShare} above ${maxWeatherShare}`,
      );
    failures.push(...ratio.failures);
  }
  if (
    weatherInstance &&
    weatherInstance.variant !== 'compact' &&
    !measurements.weatherActions.includes('showCompact')
  )
    failures.push(
      `${weatherId} is not compact: Variant ${weatherInstance.variant}, no showCompact Action`,
    );
  return {
    outcome: failures.length ? 'fail' : 'pass',
    failures,
    measurements,
  };
}

/** Dry run by default; `--live --confirm-capped-key` dispatches one request per sample. */
export async function runWeatherBelowMapSmall(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: ManualFetch = globalThis.fetch,
) {
  const options = parseArguments(args);
  verifyModel(env);
  const rules = await demoSystemRules();
  const prompt = { system: { rules: { append: rules } } };
  const cases = WEATHER_BELOW_MAP_CASES.filter(
    (entry) => options.caseId === undefined || entry.id === options.caseId,
  );
  const initialRequests = await Promise.all(cases.map(weatherBelowMapRequest));
  const configuration = {
    caseId,
    model,
    intent,
    calendarContext: (await demoCalendarContext()).context,
    samples: options.samples,
    cases: cases.map((entry, index) => ({
      ...entry,
      initialRequest: structuredClone(initialRequests[index]),
    })),
    systemPrompt: buildSystemPrompt('tiling', prompt),
    maxOutputTokens,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: cases.length * options.samples,
    deterministicPredicate: `visible(map-main, weather-main) + below(weather-main, map-main) + weather share <= ${maxWeatherShare} + weightRatio(weather-main, map-main) <= ${maxWeatherToMapRatio} + weather compact (Variant or showCompact)`,
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; default Maelstrom identity; demo system rules; current demo Vessel definitions',
  };
  if (!options.live)
    return {
      mode: 'dry-run' as const,
      configuration,
      generationDispatches: 0,
    };
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new Error('OPENAI_API_KEY is required for a live weather run');

  let generationDispatches = 0;
  const samples: {
    caseId: string;
    sample: number;
    measurements?: WeatherBelowMapMeasurements;
    result: EvaluationResult<MaelstromResponse | undefined>;
  }[] = [];
  for (const [index, entry] of cases.entries()) {
    const initial = initialRequests[index];
    for (let sample = 1; sample <= options.samples; sample++) {
      const transport = manualTransport(
        send,
        apiKey,
        model,
        maxOutputTokens,
        1,
      );
      const sessionId = SessionId(`${entry.id}-${crypto.randomUUID()}`);
      const requestId = MessageId(`${sessionId}-turn-1`);
      const result = await evaluateSample<MaelstromResponse | undefined>(
        {
          runId: sessionId,
          caseId: `${caseId}/${entry.id}`,
          runtimeId: `current-engine/${model}`,
          sample,
        },
        {
          surface: 'planner-response',
          provenance: configuration.provenance,
          async execute(context) {
            try {
              const adapter = createOpenaiChat(model, apiKey, {
                baseURL: 'https://api.openai.com/v1',
                maxRetries: 0,
                timeout: 30_000,
                logLevel: 'off',
                logger: silent,
                fetch: transport.fetch,
              });
              const engine = createEngine({
                planner: llmPlanner({
                  adapter,
                  prompt,
                  modelOptions: {
                    max_output_tokens: maxOutputTokens,
                    service_tier: 'default',
                    store: false,
                    include: [],
                  },
                }),
                retry: false,
                logger: silent,
                history: { store: createInMemoryStore(), maxEntries: 20 },
              });
              transport.beginTurn(0);
              const response = await engine.handle(
                ChartRequestMessage({
                  sessionId,
                  id: requestId,
                  request: structuredClone(initial),
                }),
                AbortSignal.timeout(35_000),
              );
              transport.assertDispatched();
              if (isErr(response) || response.value.type !== 'chart_response')
                throw new Error('Weather Engine request did not complete');
              const shipped = response.value.response;
              context.record({
                kind: 'turn',
                requestId,
                value: { request: initial, response: shipped },
              });
              return {
                completeness: 'complete',
                disposition: 'planned',
                value: shipped,
              };
            } catch {
              return {
                completeness: 'absent',
                disposition: 'planned',
                value: undefined,
                error: 'Weather sample stopped; incomplete evidence; no retry',
              };
            }
          },
          score: (response) => {
            const { outcome, failures } = scoreWeatherBelowMapSmall(
              response,
              initial,
            );
            return { outcome, failures };
          },
        },
      );
      generationDispatches += transport.count();
      const measurements =
        result.completeness === 'complete'
          ? scoreWeatherBelowMapSmall(result.observation, initial).measurements
          : undefined;
      samples.push({
        caseId: entry.id,
        sample,
        ...(measurements && { measurements }),
        result,
      });
    }
  }
  return {
    mode: 'live' as const,
    configuration,
    generationDispatches,
    summary: summarise(samples),
    summaryByCase: Object.fromEntries(
      cases.map((entry) => [
        entry.id,
        summarise(samples.filter((sample) => sample.caseId === entry.id)),
      ]),
    ),
    samples,
    limitation:
      'Scores the shipped Engine response geometry only. Readability in the browser is covered by apps/demo/e2e/weather-compact.e2e.ts. Engine healing may change the raw candidate.',
  };
}

function summarise(
  samples: readonly {
    measurements?: WeatherBelowMapMeasurements;
    result: EvaluationResult<MaelstromResponse | undefined>;
  }[],
) {
  const complete = samples.filter(
    (sample) => sample.result.completeness === 'complete',
  );
  const shares = complete
    .map((sample) => sample.measurements?.weatherShare)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  const trees: Record<string, number> = {};
  for (const sample of complete) {
    const tree = sample.measurements?.tree;
    if (tree !== undefined) trees[tree] = (trees[tree] ?? 0) + 1;
  }
  return {
    complete: complete.length,
    incomplete: samples.length - complete.length,
    passed: complete.filter((sample) => sample.result.evaluation === 'pass')
      .length,
    medianWeatherShare: median(shares),
    variantsSeen: [
      ...new Set(
        complete.flatMap((sample) =>
          sample.measurements?.weatherVariant
            ? [sample.measurements.weatherVariant]
            : [],
        ),
      ),
    ].sort(),
    trees,
  };
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : round((sorted[middle - 1] + sorted[middle]) / 2);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseArguments(args: readonly string[]) {
  let live = false;
  let confirmed = false;
  let samples: number | undefined;
  let selected: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--live' && !live) live = true;
    else if (arg === '--confirm-capped-key' && !confirmed) confirmed = true;
    else if (arg === '--samples' && samples === undefined) {
      const value = args[++index];
      if (value === undefined || !/^\d+$/.test(value)) throw new Error(usage);
      samples = Number(value);
      if (samples < 1 || samples > 10) throw new Error(usage);
    } else if (arg === '--case' && selected === undefined) {
      selected = args[++index];
      if (!WEATHER_BELOW_MAP_CASES.some((entry) => entry.id === selected))
        throw new Error(usage);
    } else throw new Error(usage);
  }
  if (confirmed !== live) throw new Error(usage);
  return { live, samples: samples ?? 1, caseId: selected };
}

let catalog: Promise<Vessel[]> | undefined;

function demoCatalog(): Promise<Vessel[]> {
  catalog ??= loadDemoCatalog();
  return catalog;
}

async function loadDemoCatalog(): Promise<Vessel[]> {
  // Fixed runtime URLs keep this manual Bun tool outside the demo's TypeScript build graph.
  const definitions = await Promise.all(
    (
      [
        ['calendar', 'calendarVessel'],
        ['weather', 'weatherVessel'],
        ['journal', 'journalVessel'],
        ['tasks', 'tasksVessel'],
        ['map', 'mapVessel'],
        ['labs', 'labsVessel'],
      ] as const
    ).map(async ([file, name]) => {
      const module: Record<string, unknown> = await import(
        new URL(
          `../../../../apps/demo/src/vessels/${file}.vessel.def.ts`,
          import.meta.url,
        ).href
      );
      return VesselSchema.parse(module[name]);
    }),
  );
  return definitions;
}

interface CalendarContext {
  readonly localDate: string;
  readonly timeZone: string;
  readonly observedAt: string;
}

async function demoCalendarContext(): Promise<{
  context: CalendarContext;
  withBrowserCalendarContext: (
    message: ChartRequestMessage,
    calendar: CalendarContext,
  ) => ChartRequestMessage;
}> {
  const module: {
    browserCalendarContext?: unknown;
    withBrowserCalendarContext?: unknown;
  } = await import(
    new URL(
      '../../../../apps/demo/src/lib/calendar-context.ts',
      import.meta.url,
    ).href
  );
  if (
    typeof module.browserCalendarContext !== 'function' ||
    typeof module.withBrowserCalendarContext !== 'function'
  )
    throw new Error('Demo calendar context changed; review this manual runner');
  // A fixed instant keeps the prompt identical across runs.
  return {
    context: module.browserCalendarContext(
      new Date('2026-11-02T12:00:00.000Z'),
      'Europe/Warsaw',
    ),
    withBrowserCalendarContext: module.withBrowserCalendarContext as (
      message: ChartRequestMessage,
      calendar: CalendarContext,
    ) => ChartRequestMessage,
  };
}

async function demoSystemRules(): Promise<string> {
  const module: { PLAYGROUND_SYSTEM_RULES?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/server/planner-system-rules.ts',
      import.meta.url,
    ).href
  );
  if (typeof module.PLAYGROUND_SYSTEM_RULES !== 'string')
    throw new Error('Demo system rules changed; review this manual runner');
  return module.PLAYGROUND_SYSTEM_RULES;
}

function verifyModel(env: Readonly<Record<string, string | undefined>>) {
  const source = readFileSync(
    new URL(
      '../../../../apps/demo/src/server/engine-model.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const currentDefault = source.match(
    /export const DEFAULT_ENGINE_MODEL = '([^']+)'/,
  )?.[1];
  if (
    currentDefault !== model ||
    (env.ENGINE_MODEL?.trim() || currentDefault) !== model
  )
    throw new Error(
      'Current Engine model changed; review this runner before dispatch',
    );
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'This runner requires the official endpoint without custom headers',
    );
}

if (import.meta.main) {
  try {
    const report = await runWeatherBelowMapSmall(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live')
      console.error(`Generation dispatches: ${report.generationDispatches}`);
    process.exitCode = weatherRunExitCode(report);
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'Weather run did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
