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

// The Weighted Split the live Planner eval returned most often, and in its
// median sample, for weather below the map (9 of 13 samples).
const WEATHER_BELOW_MAP_TREE: readonly TilingNode[] = [
  'H:4,1',
  'ID:map-main',
  'ID:weather-main',
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
  expect(dimensions.columns).toBeGreaterThan(0);
  expect(dimensions.rows).toBeGreaterThan(0);
});

test("renders weather readably below the map at the Planner's share", async ({
  page,
}, testInfo) => {
  test.fail(
    true,
    'The current Variant needs about 220px of height and the Planner gives weather 80 to 116px',
  );
  await stubPlanner(page, () => ({
    tree: [...WEATHER_BELOW_MAP_TREE],
    instances: [
      { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    ],
  }));
  await openDemoWithKey(page);
  await submitIntent(page, INTENT);

  const weather = page.locator('[data-instance-id="weather-main"]');
  await expect(weather).toBeVisible();
  await expect(page.locator('[data-instance-id="map-main"]')).toBeVisible();
  await expect(weather.getByText(/^72°/)).toBeAttached();
  const screenshot = testInfo.outputPath('weather-below-map.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('weather-below-map', {
    path: screenshot,
    contentType: 'image/png',
  });

  await expectNoClipping(weather);
  const essentials = {
    temperature: weather.getByText(/^72°/),
    condition: weather.getByText('Clear', { exact: true }),
    location: weather.getByText(/San Francisco/),
  };
  for (const [name, text] of Object.entries(essentials))
    await expectReadableInside(weather, text, name);
  const temperatureFontSize = await essentials.temperature.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).fontSize),
  );
  expect
    .soft(temperatureFontSize, 'temperature font size in px')
    .toBeGreaterThanOrEqual(14);
});

interface CannedLayout {
  readonly tree: readonly TilingNode[];
  readonly instances: readonly {
    readonly instanceId: string;
    readonly vesselId: string;
    readonly variant: string;
  }[];
}

async function stubPlanner(
  page: Page,
  layoutFor: (request: ChartRequest) => CannedLayout,
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
              executionPlan: [],
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
