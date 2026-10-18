import { expect, test } from '@playwright/test';

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
