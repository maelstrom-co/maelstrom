import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

async function openTelemetryFixture(page: Page, scenario = 'steady') {
  const bundle = execFileSync(
    'bun',
    [
      'build',
      fileURLToPath(new URL('./fixtures/telemetry.ts', import.meta.url)),
      '--target=browser',
      '--conditions=browser',
      '--conditions=development',
      '--conditions=@maelstrom-co/source',
    ],
    { encoding: 'utf8', maxBuffer: 5_000_000 },
  );
  await page.route('**/__telemetry-fixture.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: bundle }),
  );
  await page.route(
    (url) => url.pathname === '/__telemetry-fixture/',
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module" src="/__telemetry-fixture.js"></script></html>',
      }),
  );
  await page.goto(`/__telemetry-fixture/?scenario=${scenario}`);
  await page.getByRole('tab', { name: 'Telemetry', exact: true }).click();
}

async function openRequestComparisonFixture(page: Page) {
  const bundle = execFileSync(
    'bun',
    [
      'build',
      fileURLToPath(
        new URL('./fixtures/request-comparison.ts', import.meta.url),
      ),
      '--target=browser',
      '--conditions=browser',
      '--conditions=development',
      '--conditions=@maelstrom-co/source',
    ],
    { encoding: 'utf8', maxBuffer: 5_000_000 },
  );
  await page.route('**/__comparison-fixture.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: bundle }),
  );
  await page.route(
    (url) => url.pathname === '/__comparison-fixture/',
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module" src="/__comparison-fixture.js"></script></html>',
      }),
  );
  await page.goto('/__comparison-fixture/');
  await page
    .getByRole('combobox', { name: 'Evidence source', exact: true })
    .selectOption('imported');
  await page
    .getByRole('button', { name: 'Compare request', exact: true })
    .click();
  await page
    .locator('.list-pane')
    .getByRole('button')
    .filter({ has: page.getByText('Show the calendar', { exact: true }) })
    .click();
}

test('comparison phase navigation preserves the other request’s scroll and event selection', async ({
  page,
}) => {
  await openRequestComparisonFixture(page);
  const a = page.getByRole('region', { name: 'Comparison A', exact: true });
  const b = page.getByRole('region', { name: 'Comparison B', exact: true });
  await page
    .getByText('Compare observed event counts', { exact: true })
    .click();
  const aPhase = a
    .getByRole('button', { name: /Engine stage failed · plan/ })
    .first();
  await aPhase.click();
  await expect(
    page.locator('details').filter({
      has: page.getByText('Compare observed event counts', { exact: true }),
    }),
  ).toHaveAttribute('open', '');
  const previousScroll = await a.evaluate((node) => node.scrollTop);
  expect(previousScroll).toBeGreaterThan(0);
  const bPhase = b
    .getByRole('button', { name: /Engine stage completed · plan/ })
    .first();
  await bPhase.focus();
  await page.keyboard.press('Enter');
  await expect(
    a.getByRole('button', { name: /Engine stage failed · plan/ }).first(),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await a.evaluate((node) => node.scrollTop)).toBe(previousScroll);
  await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
  const json = page.locator('.json-raw');
  await expect(json).toContainText('a-stage-1');
  await a.getByRole('button', { name: 'Inspect A JSON', exact: true }).click();
  await expect(json).toContainText('b-stage-0');
});

test('telemetry axis labels remain inside the chart for fractional tick values', async ({
  page,
}) => {
  await openTelemetryFixture(page);
  const chart = page.getByRole('img', {
    name: 'Queue depth and exporter activity',
    exact: true,
  });
  await expect(chart).toContainText('20.5');
  const clipped = await chart
    .locator('text')
    .evaluateAll((labels) =>
      labels
        .filter((label) => (label as SVGTextElement).getBBox().x < 0)
        .map((label) => label.textContent),
    );
  expect(clipped).toEqual([]);
});

test('telemetry polling keeps a focused sample visible when the table overflows', async ({
  page,
}) => {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await openTelemetryFixture(page);
  const table = page.getByRole('table', { name: 'Telemetry samples' });
  const first = table.getByRole('button', {
    name: 'Select telemetry sample 1',
    exact: true,
  });
  await first.focus();
  await page.clock.runFor(20000);
  await expect(table.locator('tbody tr')).toHaveCount(21);
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport({ ratio: 1 });
  await page
    .getByRole('button', { name: 'Follow latest', exact: true })
    .focus();
  await page.clock.runFor(1000);
  expect(
    await table.evaluate((node) => {
      const scroll = node.parentElement;
      if (!scroll)
        throw new Error('Telemetry table must have a scroll container');
      return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    }),
  ).toBeLessThanOrEqual(1);
});

test('an expired telemetry selection keeps retained samples reachable by Tab', async ({
  page,
}) => {
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await openTelemetryFixture(page);
  const table = page.getByRole('table', { name: 'Telemetry samples' });
  await table
    .getByRole('button', { name: 'Select telemetry sample 1', exact: true })
    .click();
  await page.clock.runFor(120000);
  const follow = page.getByRole('button', {
    name: 'Follow latest',
    exact: true,
  });
  const details = page.getByRole('region', {
    name: 'Selected telemetry sample',
    exact: true,
  });
  await expect(follow).toBeFocused();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await expect(details).toContainText('Selected sample expired');
  await expect(details.locator('pre')).toBeHidden();
  const latest = table.getByRole('button', {
    name: 'Select telemetry sample 121',
    exact: true,
  });
  // Narrow charts can become native scroll-container Tab stops before the table.
  for (let step = 0; step < 3; step++) {
    await page.keyboard.press('Tab');
    if (await latest.evaluate((node) => node.matches(':focus'))) break;
  }
  await expect(latest).toBeFocused();
  await expect(latest).toBeInViewport({ ratio: 1 });
  await expect(latest).toHaveAttribute('aria-pressed', 'false');
  await expect(details).toContainText('Selected sample expired');
  await page.keyboard.press('Home');
  await expect(details.getByRole('heading', { level: 4 })).toContainText(
    'Sample 2',
  );
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
});

test('a horizontally scrolled telemetry chart selects the nearest observed time', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await openTelemetryFixture(page, 'advancing');
  await page.clock.fastForward(3500);
  await page.clock.fastForward(1250);
  const chart = page.getByRole('img', {
    name: 'Queue depth and exporter activity',
    exact: true,
  });
  await chart.scrollIntoViewIfNeeded();
  const figure = chart.locator('..');
  await figure.hover();
  await page.mouse.wheel(1000, 0);
  await expect
    .poll(() => figure.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      figure.evaluate(
        (node) => node.scrollWidth - node.clientWidth - node.scrollLeft,
      ),
    )
    .toBeLessThanOrEqual(1);
  const bounds = await chart.boundingBox();
  if (!bounds) throw new Error('Telemetry chart must be visible');
  await page.mouse.click(
    bounds.x + bounds.width * 0.75,
    bounds.y + bounds.height / 2,
  );
  const details = page.getByRole('region', {
    name: 'Selected telemetry sample',
    exact: true,
  });
  await expect(details.getByRole('heading', { level: 4 })).toContainText(
    'Sample 2',
  );
  expect(JSON.parse(await details.locator('pre').innerText()).accepted).toBe(
    107,
  );
  await expect(
    details.locator('[aria-label="Selected sample interval"]'),
  ).toContainText('+7 · 2/s');
});

test('telemetry charts preserve selected samples and keyboard focus across polling', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Maelstrom Devtools' }).click();
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(new Date(now.getTime() + 1000));
  await page.getByRole('tab', { name: 'Telemetry', exact: true }).click();
  const trends = page.getByRole('region', {
    name: 'Telemetry delivery trends',
    exact: true,
  });
  const table = trends.getByRole('table', { name: 'Telemetry samples' });
  await expect(table.locator('tbody tr')).toHaveCount(1);
  const first = table.getByRole('button', {
    name: 'Select telemetry sample 1',
    exact: true,
  });
  const details = trends.getByRole('region', {
    name: 'Selected telemetry sample',
    exact: true,
  });
  await first.focus();
  await page.clock.runFor(2000);
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(details.getByRole('heading', { level: 4 })).toContainText(
    'Sample 2',
  );
  await first.focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(1000);
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await expect(details.getByRole('heading', { level: 4 })).toContainText(
    'Sample 1',
  );
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(details.getByRole('heading', { level: 4 })).toContainText(
    'Sample 2',
  );
  await expect(
    table.getByRole('button', {
      name: 'Select telemetry sample 2',
      exact: true,
    }),
  ).toBeFocused();
  expect(JSON.parse(await details.locator('pre').innerText())).toHaveProperty(
    'dropped',
  );
  for (const title of [
    'Queue depth and exporter activity',
    'Local delivery rates',
  ]) {
    const chart = trends.getByRole('img', { name: title, exact: true });
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toBeInViewport();
    expect((await chart.boundingBox())?.height).toBeGreaterThan(50);
  }
});

test('request phases support keyboard selection beside independently scrolling JSON', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Maelstrom Devtools' }).click();
  const panel = page.getByRole('region', { name: 'Maelstrom Devtools' });
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'phases.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        capture: {
          schemaVersion: 1,
          active: false,
          metadata: {},
          events: Array.from({ length: 205 }, (_, index) => ({
            id: `phase-${index}`,
            sessionId: 'browser-fixture',
            requestId: 'long-request',
            kind: 'engine.stage.completed',
            at: index,
            metadata: {
              clientId: 'fixture-app',
              stage: `step-${index}`,
              outcome: 'succeeded',
              durationMs: index,
            },
          })),
        },
      }),
    ),
  });
  await expect(
    page.getByRole('combobox', { name: 'Evidence source' }),
  ).toHaveValue('imported');
  await page.getByRole('button', { name: 'Pin request', exact: true }).click();
  await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
  const more = page.getByRole('button', {
    name: 'Show more phases',
    exact: true,
  });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toBeFocused();
  const phases = page.getByRole('table', {
    name: 'Request phases',
    exact: true,
  });
  await page.keyboard.press('Enter');
  await expect(phases.locator('tbody tr')).toHaveCount(5);
  const previous = page.getByRole('button', {
    name: 'Previous phases',
    exact: true,
  });
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(previous).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(phases.locator('tbody tr')).toHaveCount(200);
  await more.focus();
  await page.keyboard.press('Enter');
  const last = phases.getByRole('button', { name: /step-204/ });
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(last).toHaveAttribute('aria-pressed', 'true');
  const raw = page.getByRole('region', { name: 'Raw JSON', exact: true });
  await expect(raw).toContainText('step-204');
  const jsonScroll = await raw.evaluate((node) => node.scrollTop);
  const details = page.getByRole('region', {
    name: 'Diagnostic details',
    exact: true,
  });
  await details.scrollIntoViewIfNeeded();
  await details.hover();
  await page.mouse.wheel(0, -100000);
  await expect.poll(() => details.evaluate((node) => node.scrollTop)).toBe(0);
  expect(await raw.evaluate((node) => node.scrollTop)).toBe(jsonScroll);
  await page.getByRole('checkbox', { name: 'Show duration bars' }).uncheck();
  await expect(phases.locator('.phase-track').first()).toBeHidden();
  await raw.scrollIntoViewIfNeeded();
  await expect(raw).toBeInViewport();
  await expect(raw).toContainText('step-204');
});

test('recording notes use the visible question and imported read-only label as their accessible names', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Maelstrom Devtools' }).click();
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Maelstrom Devtools' });
  const note = panel.getByRole('textbox');
  await expect(note).toHaveAccessibleName(
    'What did you expect? What happened?',
  );
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'recording.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        capture: {
          schemaVersion: 1,
          active: false,
          metadata: {},
          events: [],
          outcome: 'Expected the next week. The calendar stayed unchanged.',
        },
      }),
    ),
  });
  await expect(
    page.getByRole('combobox', { name: 'Evidence source' }),
  ).toHaveValue('imported');
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click();
  await expect(note).toHaveAccessibleName('Recorded note (read-only)');
  await expect(note).not.toBeEditable();
  await expect(note).toHaveValue(
    'Expected the next week. The calendar stayed unchanged.',
  );
});

test('a resized desktop panel lets wheel scrolling reach the bottom of its workspace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Maelstrom Devtools' }).click();
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  const resize = page.getByRole('separator', { name: 'Resize devtools' });
  await resize.focus();
  for (let step = 0; step < 20; step++) await page.keyboard.press('ArrowDown');
  await expect(resize).toHaveAttribute('aria-valuenow', '260');
  const workspace = page.locator('.workspace');
  expect(await workspace.evaluate((node) => node.scrollTop)).toBe(0);
  expect(
    await workspace.evaluate((node) => node.scrollHeight - node.clientHeight),
  ).toBeGreaterThan(0);
  const details = await page
    .getByRole('region', { name: 'Diagnostic details' })
    .boundingBox();
  if (!details) throw new Error('Diagnostic details must be visible');
  await page.mouse.move(details.x + 24, details.y + 24);
  for (let step = 0; step < 4; step++) {
    await page.mouse.wheel(0, 500);
  }
  await expect
    .poll(() =>
      workspace.evaluate((node) =>
        Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(1);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 768 },
]) {
  test(`DevTools keeps JSON readable at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const open = page.getByRole('button', {
      name: 'Open Maelstrom Devtools',
      exact: true,
    });
    await open.click();

    for (const tab of ['Requests', 'Inspector', 'Connections']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      for (const mode of ['Tree', 'Raw JSON']) {
        await page.getByRole('button', { name: mode, exact: true }).click();
        const json = page.getByRole('region', {
          name: mode === 'Tree' ? 'JSON tree' : 'Raw JSON',
          exact: true,
        });
        await json.scrollIntoViewIfNeeded();
        await expect(json).toBeInViewport();
        const readableLines = await json.evaluate((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          let top = Math.max(
            0,
            rect.top + node.clientTop + Number.parseFloat(style.paddingTop),
          );
          let bottom = Math.min(
            window.innerHeight,
            rect.top +
              node.clientTop +
              node.clientHeight -
              Number.parseFloat(style.paddingBottom),
          );
          for (
            let parent = node.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            if (getComputedStyle(parent).overflowY === 'visible') continue;
            const bounds = parent.getBoundingClientRect();
            top = Math.max(top, bounds.top + parent.clientTop);
            bottom = Math.min(
              bottom,
              bounds.top + parent.clientTop + parent.clientHeight,
            );
          }
          return (
            Math.max(0, bottom - top) / Number.parseFloat(style.lineHeight)
          );
        });
        expect(readableLines).toBeGreaterThanOrEqual(3);
      }
    }
  });
}

test('layout changes support keyboard inspection beside retained JSON', async ({
  page,
}) => {
  const snapshot = (after: boolean) => ({
    version: 1,
    instanceCount: 1,
    instances: [
      {
        instanceId: 'calendar',
        vesselId: 'calendar',
        variant: after ? 'week' : 'month',
      },
    ],
    layoutMode: 'grid',
    chartDimensions: { columns: 8, rows: 4 },
    layout: {
      type: 'grid',
      positions: [
        {
          instanceId: 'calendar',
          position: { column: after ? 2 : 0, row: 0 },
          size: { width: after ? 4 : 2, height: 4 },
        },
      ],
    },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Maelstrom Devtools' }).click();
  const panel = page.getByRole('region', { name: 'Maelstrom Devtools' });
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'layout-comparison.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        capture: {
          schemaVersion: 1,
          active: false,
          metadata: {},
          events: [
            {
              id: 'before-layout',
              at: 1,
              sessionId: 'layout-fixture',
              requestId: 'compare',
              kind: 'client.command.started',
              metadata: { clientId: 'fixture-app', command: 'set_layout' },
              content: { layoutSnapshot: snapshot(false) },
            },
            {
              id: 'after-layout',
              at: 2,
              sessionId: 'layout-fixture',
              requestId: 'compare',
              kind: 'client.response.applied',
              metadata: { clientId: 'fixture-app' },
              content: { layoutSnapshot: snapshot(true) },
            },
          ],
        },
      }),
    ),
  });
  const comparison = panel.locator('[aria-label="Request layout comparison"]');
  await expect(comparison).toContainText('Moved, Resized, Variant changed');
  await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
  const before = comparison.getByRole('button', {
    name: 'Before Instance calendar: Moved, Resized, Variant changed',
    exact: true,
  });
  await before.focus();
  await page.keyboard.press('Enter');
  await expect(before).toBeFocused();
  await expect(panel.locator('.json-raw')).toContainText('before-layout');
  const change = comparison.getByRole('button', {
    name: 'calendar: Moved, Resized, Variant changed',
    exact: true,
  });
  await change.focus();
  await page.keyboard.press('Enter');
  await expect(change).toBeFocused();
  await expect(panel.locator('.json-raw')).toContainText('after-layout');
  await expect(comparison).toContainText(
    'Before: month · visible. After: week · visible.',
  );
  await expect(panel.locator('.content-pane')).toBeVisible();
  await expect(panel.locator('.json-pane')).toBeVisible();
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'first-grid-layout.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        capture: {
          schemaVersion: 1,
          active: false,
          metadata: {},
          events: [
            {
              id: 'empty-grid',
              at: 1,
              sessionId: 'layout-fixture',
              requestId: 'first-grid',
              kind: 'client.command.started',
              metadata: { clientId: 'fixture-app', command: 'set_layout' },
              content: {
                layoutSnapshot: {
                  ...snapshot(false),
                  instanceCount: 0,
                  instances: [],
                  layout: null,
                },
              },
            },
            {
              id: 'first-grid-after',
              at: 2,
              sessionId: 'layout-fixture',
              requestId: 'first-grid',
              kind: 'client.response.applied',
              metadata: { clientId: 'fixture-app' },
              content: { layoutSnapshot: snapshot(true) },
            },
          ],
        },
      }),
    ),
  });
  await expect(comparison.locator('figcaption').first()).toContainText(
    'Grid cells',
  );
  await expect(comparison).toContainText('No visible Instances');
  await expect(
    comparison.getByRole('table', { name: 'Instance layout changes' }),
  ).toContainText('Added');
});
