import {
  type ChartRequest,
  decodeClientEnvelope,
  encodeEnvelope,
  InstanceId,
  isOk,
  MaelstromResponseMessage,
  type TilingNode,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { expect, type Locator, type Page, test } from '@playwright/test';

const INTENT = 'Put weather below the map and make it very small';

// The Weighted Split the live Planner eval returned most often for weather
// below the map before the compact Variant existed (9 of 13 samples).
const WEATHER_BELOW_MAP_TREE: readonly TilingNode[] = [
  'H:4,1',
  'ID:map-main',
  'ID:weather-main',
];

// The target "very small" share, the split the live eval returns with the
// compact Variant (13 of 13 samples beside the map), and the earlier split.
const COMPACT_TREES: readonly (readonly TilingNode[])[] = [
  ['H:6,1', 'ID:map-main', 'ID:weather-main'],
  ['H:7,1', 'ID:map-main', 'ID:weather-main'],
  WEATHER_BELOW_MAP_TREE,
];

const HOURS = Array.from(
  { length: 12 },
  (_, hour) => `2026-11-02T${String(hour + 9).padStart(2, '0')}:00`,
);
const DAYS = Array.from(
  { length: 7 },
  (_, day) => `2026-11-${String(day + 2).padStart(2, '0')}`,
);
const CLEAR_FORECAST = {
  current: {
    time: HOURS[0],
    temperature_2m: 72,
    weather_code: 0,
    wind_speed_10m: 8,
  },
  hourly: {
    time: HOURS,
    temperature_2m: HOURS.map(() => 72),
    weather_code: HOURS.map(() => 0),
  },
  daily: {
    time: DAYS,
    temperature_2m_max: DAYS.map(() => 75),
    temperature_2m_min: DAYS.map(() => 58),
    weather_code: DAYS.map(() => 0),
  },
};

test('measures the Chart', async ({ page }, testInfo) => {
  const requests = await stubPlanner(page, (request) => ({
    tree: request.layout.type === 'tiling' ? request.layout.tree : [],
    instances: request.instances.map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
    })),
  }));
  await openDemoWithKey(page);
  await submitIntent(page, INTENT);
  await expect.poll(() => requests.length).toBeGreaterThan(0);

  const dimensions = requests[0].context.chartDimensions;
  const host = await page.locator('main.demo-main').boundingBox();
  const measurement = {
    project: testInfo.project.name,
    viewport: page.viewportSize(),
    chartDimensions: dimensions,
    chartHost: host && { width: host.width, height: host.height },
  };
  console.log(`chart-measurement ${JSON.stringify(measurement)}`);
  await testInfo.attach('chart-measurement', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
  // packages/evals/src/manual/weather-below-map-small.ts scores live samples at
  // these sizes. Update both together when the demo Chart changes.
  expect(dimensions).toEqual(
    testInfo.project.name === 'mobile'
      ? { columns: 4, rows: 5 }
      : { columns: 18, rows: 7 },
  );
});

for (const tree of COMPACT_TREES)
  test(`renders compact weather as one readable line below the map at ${tree[0]}`, async ({
    page,
  }, testInfo) => {
    await expectCompactStripBelowMap(page, tree, testInfo.outputPath());
  });

test.describe('at 1024x768', () => {
  test.use({ viewport: { width: 1_024, height: 768 } });
  for (const tree of COMPACT_TREES)
    test(`renders compact weather as one readable line below the map at ${tree[0]}`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name === 'mobile',
        'The mobile project covers its own viewport',
      );
      await expectCompactStripBelowMap(page, tree, testInfo.outputPath());
    });
});

test('switches between compact and fuller weather views through Actions', async ({
  page,
}) => {
  const steps: readonly {
    readonly intent: string;
    readonly action: string;
    readonly tree: readonly TilingNode[];
    readonly expectContent: (weather: Locator) => Promise<void>;
  }[] = [
    {
      intent: 'Make the weather very small',
      action: 'showCompact',
      tree: ['H:6,1', 'ID:map-main', 'ID:weather-main'],
      expectContent: async (weather) => {
        await expect(
          weather.locator('[data-weather-variant="compact"]'),
        ).toBeVisible();
        await expectEssentials(weather);
      },
    },
    {
      intent: 'Show current conditions',
      action: 'showCurrent',
      tree: ['H', 'ID:map-main', 'ID:weather-main'],
      expectContent: async (weather) => {
        await expect(weather.getByText(/km\/h|mph/)).toBeVisible();
        await expectReadableInside(
          weather,
          weather.getByText(/^72°/),
          'temperature',
        );
      },
    },
    {
      intent: 'Show the weekly forecast',
      action: 'showWeekly',
      tree: ['H', 'ID:map-main', 'ID:weather-main'],
      expectContent: async (weather) => {
        await expect(weather.getByText('Weekly Forecast')).toBeVisible();
      },
    },
    {
      intent: 'Back to small weather',
      action: 'showCompact',
      tree: ['H:6,1', 'ID:map-main', 'ID:weather-main'],
      expectContent: async (weather) => {
        await expect(
          weather.locator('[data-weather-variant="compact"]'),
        ).toBeVisible();
        await expect(weather.getByText('Weekly Forecast')).toHaveCount(0);
        await expectEssentials(weather);
      },
    },
  ];
  let current: CannedResponse = {
    tree: ['H', 'ID:map-main', 'ID:weather-main'],
    instances: mapAndWeather('current'),
  };
  await stubPlanner(page, (request) => {
    const intent = latestIntent(request);
    // The demo appends browser calendar context to every typed intent.
    const step = steps.find((entry) => intent?.startsWith(entry.intent));
    if (!step) return current;
    // The Engine replays the Execution Plan and ships each Instance in its
    // final Variant, so the canned Layout carries the Action's target.
    current = {
      tree: step.tree,
      instances: mapAndWeather(step.action.replace(/^show/, '').toLowerCase()),
    };
    return {
      ...current,
      executionPlan: [{ instanceId: 'weather-main', action: step.action }],
    };
  });
  await openDemoWithKey(page);
  const weather = page.locator('[data-instance-id="weather-main"]');
  for (const step of steps) {
    await submitIntent(page, step.intent);
    await step.expectContent(weather);
    await expectNoClipping(weather);
  }
});

interface CannedResponse {
  readonly tree: readonly TilingNode[];
  readonly instances: readonly {
    readonly instanceId: string;
    readonly vesselId: string;
    readonly variant: string;
  }[];
  readonly executionPlan?: readonly {
    readonly instanceId: string;
    readonly action: string;
  }[];
}

async function expectCompactStripBelowMap(
  page: Page,
  tree: readonly TilingNode[],
  outputDirectory: string,
) {
  await stubPlanner(page, () => ({
    tree,
    instances: mapAndWeather('compact'),
  }));
  await openDemoWithKey(page);
  await submitIntent(page, INTENT);

  const weather = page.locator('[data-instance-id="weather-main"]');
  await expect(page.locator('[data-instance-id="map-main"]')).toBeVisible();
  await expect(
    weather.locator('[data-weather-variant="compact"]'),
  ).toBeVisible();
  await page.screenshot({
    path: `${outputDirectory}/compact-${tree[0]?.replace(/[^\w]/g, '-')}.png`,
  });
  await expectNoClipping(weather);
  await expectEssentials(weather);
}

async function settle(instance: Locator) {
  // Chart motion animates Instance moves and resizes, so measure afterwards.
  await instance.evaluate(async (root) => {
    const chart = root.parentElement ?? root;
    await Promise.all(
      chart
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function expectEssentials(weather: Locator) {
  await settle(weather);
  const essentials = {
    temperature: weather.getByText(/^72°/),
    condition: weather.getByText('Clear', { exact: true }),
    location: weather.getByText(/San Francisco/),
  };
  const centres: number[] = [];
  for (const [name, text] of Object.entries(essentials)) {
    await expectReadableInside(weather, text, name);
    const box = await text.boundingBox();
    if (box) centres.push(box.y + box.height / 2);
  }
  expect
    .soft(
      Math.max(...centres) - Math.min(...centres),
      'essentials share one line',
    )
    .toBeLessThan(6);
  const temperatureFontSize = await essentials.temperature.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize),
  );
  expect
    .soft(temperatureFontSize, 'temperature font size in px')
    .toBeGreaterThanOrEqual(14);
}

function mapAndWeather(weatherVariant: string) {
  return [
    { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
    {
      instanceId: 'weather-main',
      vesselId: 'weather',
      variant: weatherVariant,
    },
  ];
}

function latestIntent(request: ChartRequest): string | undefined {
  return request.context.updateReasons.findLast(
    (reason) => reason.type === 'user_intent',
  )?.intent;
}

async function stubPlanner(
  page: Page,
  layoutFor: (request: ChartRequest) => CannedResponse,
): Promise<ChartRequest[]> {
  const requests: ChartRequest[] = [];
  await page.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ json: CLEAR_FORECAST }),
  );
  await page.route('https://tiles.openfreemap.org/**', (route) =>
    route.fulfill({
      json: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background' }],
      },
    }),
  );
  await page.routeWebSocket('**/ws?*', (socket) => {
    socket.onMessage((raw) => {
      const frame = decodeClientEnvelope(raw);
      if (!isOk(frame) || frame.value.type !== 'chart_request') return;
      const message = frame.value;
      requests.push(message.request);
      const layout = layoutFor(message.request);
      socket.send(
        encodeEnvelope(
          MaelstromResponseMessage({
            requestId: message.id,
            sessionId: message.sessionId,
            response: {
              type: 'maelstrom_response',
              requestId: message.id,
              userMessage: '',
              rationale: '',
              executionPlan: (layout.executionPlan ?? []).map((step) => ({
                instanceId: InstanceId(step.instanceId),
                action: step.action,
              })),
              layout: {
                type: 'tiling',
                tree: [...layout.tree],
                instances: layout.instances.map((instance) => ({
                  instanceId: InstanceId(instance.instanceId),
                  vesselId: VesselId(instance.vesselId),
                  variant: VariantName(instance.variant),
                })),
              },
            },
          }),
        ),
      );
    });
  });
  return requests;
}

async function openDemoWithKey(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'API key' }).click();
  await page
    .getByRole('textbox', { name: 'API key' })
    .fill('sk-test-weather-compact-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save' }).click();
}

async function submitIntent(page: Page, intent: string) {
  const input = page.locator('#demo-intent');
  await input.fill(intent);
  await input.press('Enter');
}

async function expectNoClipping(instance: Locator) {
  await settle(instance);
  const clipped = await instance.evaluate((root) => {
    const boxes = [root, ...root.querySelectorAll('*')].filter((element) => {
      // Screen-reader-only labels are clipped to 1px on purpose.
      if (!(element instanceof HTMLElement) || element.clientHeight <= 1)
        return false;
      const style = getComputedStyle(element);
      return (
        element === root ||
        style.overflowX !== 'visible' ||
        style.overflowY !== 'visible'
      );
    });
    return boxes
      .filter(
        (element) =>
          element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1,
      )
      .map(
        (element) =>
          `${element.className || element.tagName}: scroll ${element.scrollWidth}x${element.scrollHeight}, client ${element.clientWidth}x${element.clientHeight}`,
      );
  });
  expect.soft(clipped, 'weather content overflows its box').toEqual([]);
}

async function expectReadableInside(
  instance: Locator,
  text: Locator,
  name: string,
) {
  const count = await text.count();
  expect.soft(count, `${name} text appears once`).toBe(1);
  if (count !== 1) return;
  const outer = await instance.boundingBox();
  const inner = await text.boundingBox();
  expect.soft(inner, `${name} text has a box`).not.toBeNull();
  if (!outer || !inner) return;
  // A screen-reader-only label has a 1px box: present but not readable.
  expect
    .soft(inner.width, `${name} text is visibly rendered`)
    .toBeGreaterThan(4);
  expect
    .soft(inner.height, `${name} text is visibly rendered`)
    .toBeGreaterThan(8);
  expect
    .soft(inner.x, `${name} text starts inside the Instance`)
    .toBeGreaterThan(outer.x - 1);
  expect
    .soft(inner.y, `${name} text starts inside the Instance`)
    .toBeGreaterThan(outer.y - 1);
  expect
    .soft(inner.x + inner.width, `${name} text ends inside the Instance`)
    .toBeLessThan(outer.x + outer.width + 1);
  expect
    .soft(inner.y + inner.height, `${name} text ends inside the Instance`)
    .toBeLessThan(outer.y + outer.height + 1);
}
