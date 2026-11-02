import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { buildSystemPrompt } from '@maelstrom-co/planner-llm';
import {
  type ChartRequest,
  type MaelstromResponse,
  MessageId,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import type { ManualFetch } from './transport.js';
import {
  runWeatherBelowMapSmall,
  scoreWeatherBelowMapSmall,
  WEATHER_BELOW_MAP_CASES,
  weatherBelowMapRequest,
  weatherRunExitCode,
} from './weather-below-map-small.js';

const env = { OPENAI_API_KEY: 'synthetic-weather-key' };
const live = ['--live', '--confirm-capped-key'];
const intent = 'Put weather below the map and make it very small';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in weather tests');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

const mapAndWeather = [
  { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
  { instanceId: 'weather-main', vesselId: 'weather', variant: 'compact' },
];

function candidate(
  tree: readonly (string | null)[],
  instances = mapAndWeather,
  executionPlan: readonly unknown[] = [],
) {
  return {
    userMessage: 'Weather is now below the map.',
    rationale: 'Synthetic response, not a model result',
    executionPlan: [...executionPlan],
    layout: { type: 'tiling', tree: [...tree], instances },
  };
}

function shipped(value: ReturnType<typeof candidate>): MaelstromResponse {
  const parsed = TilingResponseSchema.parse(value);
  return {
    ...parsed,
    type: 'maelstrom_response',
    requestId: MessageId('scorer'),
    layout: { type: 'tiling', ...parsed.layout },
  };
}

async function desktopBeside(): Promise<ChartRequest> {
  return weatherBelowMapRequest(
    WEATHER_BELOW_MAP_CASES.find(
      (entry) => entry.id === 'desktop-map-beside-weather',
    ) ?? WEATHER_BELOW_MAP_CASES[0],
  );
}

function sse(value: unknown) {
  const event = {
    type: 'response.completed',
    response: {
      id: 'synthetic-weather-response',
      model: 'gpt-6-luna',
      status: 'completed',
      output: [
        {
          type: 'message',
          id: 'synthetic-message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(value),
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
    },
  };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('weather below the map at a small share passes every check', async () => {
  const initial = await desktopBeside();
  // 18x7 Chart, H:7,1 gives weather 1/8 of the height: share 0.125.
  const score = scoreWeatherBelowMapSmall(
    shipped(candidate(['H:7,1', 'ID:map-main', 'ID:weather-main'])),
    initial,
  );
  expect(score.failures).toEqual([]);
  expect(score.outcome).toBe('pass');
  expect(score.measurements).toMatchObject({
    tree: 'H:7,1 ID:map-main ID:weather-main',
    weatherShare: 0.125,
    mapShare: 0.875,
    weatherVariant: 'compact',
    weatherActions: [],
    userMessage: 'Weather is now below the map.',
  });
  expect(score.measurements?.rects['weather-main']).toEqual({
    x: 0,
    y: 6.125,
    width: 18,
    height: 0.875,
  });
});

test('weather beside the map fails the below check', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(candidate(['V:6,1', 'ID:map-main', 'ID:weather-main'])),
    await desktopBeside(),
  );
  expect(score.outcome).toBe('fail');
  expect(score.failures.some((f) => f.startsWith('below('))).toBe(true);
});

test('weather below the map at half the Chart fails the share and dominance checks', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(candidate(['H', 'ID:map-main', 'ID:weather-main'])),
    await desktopBeside(),
  );
  expect(score.outcome).toBe('fail');
  expect(score.measurements?.weatherShare).toBe(0.5);
  expect(score.failures).toContainEqual(
    expect.stringContaining('weather share 0.5 above 0.15'),
  );
  expect(score.failures).toContainEqual(
    expect.stringContaining('weightRatio(weather-main, map-main'),
  );
});

test('missing weather fails visibility', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(candidate(['ID:map-main'], [mapAndWeather[0]])),
    await desktopBeside(),
  );
  expect(score.outcome).toBe('fail');
  expect(score.failures).toContain('weather-main is not visible');
  expect(score.measurements?.weatherShare).toBeNull();
});

test('a weather Instance the Planner names itself is found by its Vessel', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(
      candidate(
        ['H:7,1', 'ID:map-main', 'ID:weather-below-map'],
        [
          mapAndWeather[0],
          {
            ...mapAndWeather[1],
            instanceId: 'weather-below-map',
            variant: 'current',
          },
        ],
        [{ instanceId: 'weather-below-map', action: 'showCompact' }],
      ),
    ),
    await desktopBeside(),
  );
  expect(score.failures).toEqual([]);
  expect(score.measurements).toMatchObject({
    weatherInstanceId: 'weather-below-map',
    weatherShare: 0.125,
    weatherVariant: 'current',
    weatherActions: ['showCompact'],
  });
});

test('missing response fails without measurements', async () => {
  const score = scoreWeatherBelowMapSmall(undefined, await desktopBeside());
  expect(score).toEqual({
    outcome: 'fail',
    failures: ['Missing complete Engine response'],
  });
});

test('a fuller weather Variant fails the compact check even when small and below', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(
      candidate(
        ['H:7,1', 'ID:map-main', 'ID:weather-main'],
        [mapAndWeather[0], { ...mapAndWeather[1], variant: 'current' }],
      ),
    ),
    await desktopBeside(),
  );
  expect(score.outcome).toBe('fail');
  expect(score.failures).toEqual([
    'weather-main is not compact: Variant current, no showCompact Action',
  ]);
});

test('a showCompact Action on weather satisfies the compact check', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(
      candidate(
        ['H:7,1', 'ID:map-main', 'ID:weather-main'],
        [mapAndWeather[0], { ...mapAndWeather[1], variant: 'current' }],
        [{ instanceId: 'weather-main', action: 'showCompact' }],
      ),
    ),
    await desktopBeside(),
  );
  expect(score.failures).toEqual([]);
});

test('Variant change and show Actions on weather are recorded', async () => {
  const score = scoreWeatherBelowMapSmall(
    shipped(
      candidate(
        ['H:7,1', 'ID:map-main', 'ID:weather-main'],
        [mapAndWeather[0], { ...mapAndWeather[1], variant: 'weekly' }],
        [
          { instanceId: 'weather-main', action: 'showWeekly' },
          {
            instanceId: 'weather-main',
            action: 'setLocation',
            paramsJson: '{"location":"Paris"}',
          },
        ],
      ),
    ),
    await desktopBeside(),
  );
  expect(score.failures).toEqual([
    'weather-main is not compact: Variant weekly, no showCompact Action',
  ]);
  expect(score.measurements).toMatchObject({
    weatherVariant: 'weekly',
    weatherActions: ['showWeekly'],
  });
});

test('start states use the real demo catalog, the measured Chart sizes and the exact intent', async () => {
  expect(
    WEATHER_BELOW_MAP_CASES.map((entry) => [
      entry.id,
      entry.columns,
      entry.rows,
    ]),
  ).toEqual([
    ['desktop-map-open-weather-absent', 18, 7],
    ['desktop-map-beside-weather', 18, 7],
    ['mobile-map-beside-weather', 4, 5],
  ]);
  const absent = await weatherBelowMapRequest(WEATHER_BELOW_MAP_CASES[0]);
  expect(absent.vessels.map((vessel) => String(vessel.id))).toEqual([
    'calendar',
    'weather',
    'journal',
    'tasks',
    'map',
    'labs',
  ]);
  expect(
    absent.instances.map((instance) => ({
      instanceId: String(instance.instanceId),
      vesselId: String(instance.vesselId),
      variant: String(instance.variant),
    })),
  ).toEqual([
    { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'day' },
    { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
    { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
  ]);
  expect(absent.layout).toMatchObject({
    tree: ['V', 'ID:calendar-main', 'H', 'ID:map-main', 'ID:tasks-main'],
  });
  expect(absent.context.updateReasons).toEqual([
    {
      type: 'user_intent',
      intent: `${intent}\n\nBrowser calendar context for this request: {"localDate":"2026-11-02","timeZone":"Europe/Warsaw","observedAt":"2026-11-02T12:00:00.000Z"}`,
    },
  ]);
  const mobile = await weatherBelowMapRequest(WEATHER_BELOW_MAP_CASES[2]);
  expect(mobile.context.chartDimensions).toEqual({ columns: 4, rows: 5 });
  expect(mobile.layout).toMatchObject({
    tree: ['V', 'ID:map-main', 'ID:weather-main'],
  });
});

test('dry run prints the full request with demo rules and makes no dispatch or key read', async () => {
  const send = mock<ManualFetch>();
  const report = await runWeatherBelowMapSmall(
    [],
    {
      get OPENAI_API_KEY(): string {
        throw new Error('Must not read a key');
      },
    },
    send,
  );
  expect(report.mode).toBe('dry-run');
  expect(report.generationDispatches).toBe(0);
  expect(send).not.toHaveBeenCalled();
  const rules: { PLAYGROUND_SYSTEM_RULES?: string } = await import(
    new URL(
      '../../../../apps/demo/src/server/planner-system-rules.ts',
      import.meta.url,
    ).href
  );
  expect(report.configuration.systemPrompt).toBe(
    buildSystemPrompt('tiling', {
      system: { rules: { append: rules.PLAYGROUND_SYSTEM_RULES ?? '' } },
    }),
  );
  expect(report.configuration.systemPrompt).toContain(
    'Give each vessel adequate space for its content',
  );
  expect(report.configuration.provenance).toContain('demo system rules');
  expect(report.configuration.cases).toHaveLength(3);
  expect(report.configuration.cases[0].initialRequest.vessels).toHaveLength(6);
  expect(report.configuration.samples).toBe(1);
});

test('argument parsing rejects bad sample counts, unknown flags and unacknowledged live runs before dispatch', async () => {
  const send = mock<ManualFetch>();
  for (const flags of [
    ['--samples', '0'],
    ['--samples', '11'],
    ['--samples', '2.5'],
    ['--samples'],
    ['--samples', '2', '--samples', '3'],
    ['--grader'],
    ['--confirm-capped-key'],
    ['--live'],
    ['--case', 'tablet'],
    ['--live', '--live', '--confirm-capped-key'],
  ])
    await expect(runWeatherBelowMapSmall(flags, env, send)).rejects.toThrow();
  await expect(runWeatherBelowMapSmall(live, {}, send)).rejects.toThrow();
  await expect(
    runWeatherBelowMapSmall(live, { ...env, ENGINE_MODEL: 'gpt-4o' }, send),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  const ok = await runWeatherBelowMapSmall(
    ['--samples', '10', '--case', 'mobile-map-beside-weather'],
    env,
    send,
  );
  expect(ok.configuration.samples).toBe(10);
  expect(ok.configuration.cases.map((entry) => entry.id)).toEqual([
    'mobile-map-beside-weather',
  ]);
});

test('live run dispatches once per sample with a fresh session and summarises the results', async () => {
  const send = mock<ManualFetch>(async () =>
    sse(candidate(['H:7,1', 'ID:map-main', 'ID:weather-main'])),
  );
  const report = await runWeatherBelowMapSmall(
    [...live, '--samples', '2', '--case', 'desktop-map-beside-weather'],
    env,
    send,
  );
  if (report.mode !== 'live') throw new Error('Expected a live report');
  expect(send).toHaveBeenCalledTimes(2);
  expect(report.generationDispatches).toBe(2);
  expect(report.samples).toHaveLength(2);
  expect(
    new Set(report.samples.map((sample) => sample.result.identity.runId)).size,
  ).toBe(2);
  expect(report.summary).toEqual({
    complete: 2,
    incomplete: 0,
    passed: 2,
    medianWeatherShare: 0.125,
    variantsSeen: ['compact'],
    trees: { 'H:7,1 ID:map-main ID:weather-main': 2 },
  });
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
  expect(weatherRunExitCode(report)).toBe(0);
});

test('the Planner receives the demo calendar context with the intent', async () => {
  const bodies: string[] = [];
  const send = mock<ManualFetch>(async (input, init) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(String(input), init);
    bodies.push(await request.text());
    return sse(candidate(['H:7,1', 'ID:map-main', 'ID:weather-main']));
  });
  const report = await runWeatherBelowMapSmall(
    [...live, '--case', 'desktop-map-beside-weather'],
    env,
    send,
  );
  expect(report.configuration.calendarContext).toEqual({
    localDate: '2026-11-02',
    timeZone: 'Europe/Warsaw',
    observedAt: '2026-11-02T12:00:00.000Z',
  });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('Browser calendar context for this request: ');
  expect(bodies[0]).toContain('Europe/Warsaw');
});

test('the exit code is nonzero when any live sample fails or is incomplete', async () => {
  const failing = await runWeatherBelowMapSmall(
    [...live, '--case', 'desktop-map-beside-weather'],
    env,
    mock<ManualFetch>(async () =>
      sse(candidate(['V:6,1', 'ID:map-main', 'ID:weather-main'])),
    ),
  );
  expect(weatherRunExitCode(failing)).toBe(1);
  const incomplete = await runWeatherBelowMapSmall(
    [...live, '--case', 'desktop-map-beside-weather'],
    env,
    mock<ManualFetch>(async () => new Response('limit', { status: 429 })),
  );
  expect(weatherRunExitCode(incomplete)).toBe(1);
  const dryRun = await runWeatherBelowMapSmall([], env, mock<ManualFetch>());
  expect(weatherRunExitCode(dryRun)).toBe(0);
});

test('a failed dispatch is recorded as incomplete and is not retried', async () => {
  const send = mock<ManualFetch>(
    async () => new Response(`rejected ${env.OPENAI_API_KEY}`, { status: 401 }),
  );
  const report = await runWeatherBelowMapSmall(
    [...live, '--case', 'mobile-map-beside-weather'],
    env,
    send,
  );
  if (report.mode !== 'live') throw new Error('Expected a live report');
  expect(send).toHaveBeenCalledTimes(1);
  expect(report.summary).toMatchObject({ complete: 0, incomplete: 1 });
  expect(report.samples[0].result.completeness).toBe('absent');
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});
