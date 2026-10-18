import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

async function openFixture(
  page: Page,
  fixture: 'telemetry' | 'request-comparison' | 'connection-events',
  query = '',
) {
  const bundle = execFileSync(
    'bun',
    [
      'build',
      fileURLToPath(new URL(`./fixtures/${fixture}.ts`, import.meta.url)),
      '--target=browser',
      '--conditions=browser',
      '--conditions=development',
      '--conditions=@maelstrom-co/source',
    ],
    { encoding: 'utf8', maxBuffer: 5_000_000 },
  );
  const scriptPath = `/__${fixture}-fixture.js`;
  const pagePath = `/__${fixture}-fixture/`;
  await page.route(`**${scriptPath}`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: bundle }),
  );
  await page.route(
    (url) => url.pathname === pagePath,
    (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module" src="${scriptPath}"></script></html>`,
      }),
  );
  await page.goto(`${pagePath}${query}`);
}

async function openTelemetryFixture(page: Page, scenario = 'steady') {
  await openFixture(page, 'telemetry', `?${new URLSearchParams({ scenario })}`);
  await page.getByRole('tab', { name: 'Telemetry', exact: true }).click();
}

async function openRequestComparisonFixture(page: Page, query = '') {
  await openFixture(page, 'request-comparison', query);
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

test('each view keeps most of the panel for evidence and its guidance available through help', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openFixture(page, 'connection-events');
  await page
    .getByRole('combobox', { name: 'Evidence source', exact: true })
    .selectOption('imported');
  const panel = page.getByRole('region', {
    name: 'Maelstrom Devtools',
    exact: true,
  });
  for (const [tab, guidance] of [
    ['Requests', 'Follow a request from start to outcome.'],
    ['Inspector', 'Select an Instance to see its Vessel'],
    ['Connections', 'Check Engine and voice connections.'],
    ['Recordings', 'Record a problem, or inspect a saved recording.'],
    ['Telemetry', undefined],
  ] as const) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    const evidence =
      tab === 'Telemetry'
        ? page.getByRole('region', {
            name: 'Telemetry delivery health',
            exact: true,
          })
        : tab === 'Recordings'
          ? page.locator('.recording')
          : page.getByRole('region', {
              name: 'Diagnostic details',
              exact: true,
            });
    const panelBox = await panel.boundingBox();
    const evidenceBox = await evidence.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(evidenceBox).not.toBeNull();
    if (!panelBox || !evidenceBox) return;
    const visibleHeight =
      Math.min(
        panelBox.y + panelBox.height,
        evidenceBox.y + evidenceBox.height,
      ) - Math.max(panelBox.y, evidenceBox.y);
    expect(visibleHeight, `${tab} evidence space`).toBeGreaterThan(
      panelBox.height * 0.65,
    );
    if (guidance) {
      const help = page.locator('details').filter({
        has: page.getByText('Using DevTools', { exact: true }),
      });
      const summary = help.locator('summary');
      await expect(summary).toBeVisible();
      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(help).toHaveAttribute('open', '');
      await expect(help.getByText(guidance, { exact: false })).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(help).not.toHaveAttribute('open', '');
    }
  }
});

test('comparison keeps request details and both JSON inspectors visible as the panel grows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1695, height: 1394 });
  await openRequestComparisonFixture(page);
  const viewport = page.getByRole('region', {
    name: 'Diagnostic details',
    exact: true,
  });
  for (const side of ['A', 'B'])
    await page
      .getByRole('button', {
        name: `${side} event JSON: Raw JSON`,
        exact: true,
      })
      .click();
  for (const height of [620, 878]) {
    const resize = page.getByRole('separator', { name: 'Resize devtools' });
    const handle = await resize.boundingBox();
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, 1394 - height, {
      steps: 8,
    });
    await page.mouse.up();
    await viewport.focus();
    await page.keyboard.press('Home');
    await expect
      .poll(() => viewport.evaluate((node) => node.scrollTop))
      .toBe(0);
    const bounds = await viewport.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    for (const side of ['A', 'B']) {
      const details = page.getByRole('region', {
        name: `${side} request details`,
        exact: true,
      });
      const json = page.getByRole('complementary', {
        name: `${side} event JSON`,
        exact: true,
      });
      for (const region of [details, json]) {
        const box = await region.boundingBox();
        expect(box).not.toBeNull();
        if (!box) return;
        expect(box.y).toBeGreaterThanOrEqual(bounds.y);
        expect(box.y + box.height).toBeLessThanOrEqual(
          bounds.y + bounds.height,
        );
      }
      expect((await details.boundingBox())?.height).toBeGreaterThan(
        height === 620 ? 120 : 300,
      );
      expect(
        await json
          .getByRole('region', {
            name: `${side} event JSON: Raw JSON`,
            exact: true,
          })
          .evaluate((node) => node.clientHeight),
      ).toBeGreaterThan(100);
    }
  }
});

test('a tall comparison shows the first phases without scrolling past duplicate timing summaries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1695, height: 1394 });
  await openRequestComparisonFixture(page);
  const resize = page.getByRole('separator', { name: 'Resize devtools' });
  const handle = await resize.boundingBox();
  expect(handle).not.toBeNull();
  if (!handle) return;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, 516, { steps: 8 });
  await page.mouse.up();
  for (const side of ['A', 'B']) {
    const details = page.getByRole('region', {
      name: `${side} request details`,
      exact: true,
    });
    expect(await details.evaluate((node) => node.scrollTop)).toBe(0);
    const bounds = await details.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    const secondPhase = await details
      .locator('.phase-select')
      .nth(1)
      .boundingBox();
    expect(secondPhase).not.toBeNull();
    if (!secondPhase) return;
    expect(secondPhase.y + secondPhase.height).toBeLessThanOrEqual(
      bounds.y + bounds.height,
    );
  }
});

test('comparison presentation keeps keyboard focus, JSON selection, and revealed stage timings', async ({
  page,
}) => {
  await openRequestComparisonFixture(page);
  const a = page.getByRole('region', { name: 'Comparison A', exact: true });
  const b = page.getByRole('region', { name: 'Comparison B', exact: true });
  await b.locator('.phase-select').first().click();
  await b
    .getByRole('button', { name: 'B event JSON: Raw JSON', exact: true })
    .click();
  const json = b.getByRole('region', {
    name: 'B event JSON: Raw JSON',
    exact: true,
  });
  const selected = await json.innerText();
  const bars = a.getByRole('checkbox', { name: 'Show duration bars' });
  await bars.focus();
  await page.keyboard.press('Space');
  await expect(bars).toBeFocused();
  await expect(json).toHaveText(selected);
  await a.getByText('Timings and evidence coverage', { exact: true }).click();
  await a
    .getByRole('button', { name: 'Show more stage timings', exact: true })
    .click();
  await expect(a.getByRole('status')).toHaveText(
    'Showing 205 of 205 stage timings',
  );
  await b.locator('.phase-select').first().click();
  await expect(a.getByRole('status')).toHaveText(
    'Showing 205 of 205 stage timings',
  );
});

test('recorded comparison arguments can be explored together with independent JSON modes', async ({
  page,
}) => {
  await openRequestComparisonFixture(page);
  const a = page.getByRole('region', { name: 'Comparison A', exact: true });
  const b = page.getByRole('region', { name: 'Comparison B', exact: true });
  for (const side of [a, b]) {
    await side
      .getByRole('button', { name: 'Show more phases', exact: true })
      .click();
    await side.locator('.phase-select').filter({ hasText: 'open' }).click();
  }
  await a
    .getByRole('button', { name: 'A event JSON: Raw JSON', exact: true })
    .click();
  await expect(
    a.getByRole('region', { name: 'A event JSON: Raw JSON', exact: true }),
  ).toContainText('Tuesday');
  const tree = b.getByRole('region', {
    name: 'B event JSON: JSON tree',
    exact: true,
  });
  await expect(tree).toBeVisible();
  await expect(tree).toContainText('Monday');
  await b
    .getByRole('button', { name: 'B event JSON: Collapse all', exact: true })
    .click();
  await expect(
    b.getByRole('button', { name: 'B event JSON: Expand root', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false');
  await b
    .getByRole('button', { name: 'B event JSON: Expand root', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(tree).toContainText('Monday');
  await expect(
    a.getByRole('region', { name: 'A event JSON: Raw JSON', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Show JSON', exact: true })
    .uncheck();
  await expect(
    a.getByRole('complementary', { name: 'A event JSON', exact: true }),
  ).toBeHidden();
  await expect(
    b.getByRole('complementary', { name: 'B event JSON', exact: true }),
  ).toBeHidden();
  await page.getByRole('checkbox', { name: 'Show JSON', exact: true }).check();
  await expect(
    a.getByRole('complementary', { name: 'A event JSON', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Exit comparison', exact: true })
    .click();
  await expect(
    page.getByRole('complementary', { name: 'JSON evidence', exact: true }),
  ).toBeVisible();
});

test('comparison phase navigation preserves the other request’s scroll and event selection', async ({
  page,
}) => {
  await openRequestComparisonFixture(page);
  const a = page.getByRole('region', { name: 'Comparison A', exact: true });
  const b = page.getByRole('region', { name: 'Comparison B', exact: true });
  const aDetails = a.getByRole('region', {
    name: 'A request details',
    exact: true,
  });
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
  const previousScroll = await aDetails.evaluate((node) => node.scrollTop);
  expect(previousScroll).toBeGreaterThan(0);
  const bPhase = b
    .getByRole('button', { name: /Engine stage completed · plan/ })
    .first();
  await bPhase.focus();
  await page.keyboard.press('Enter');
  await expect(
    a.getByRole('button', { name: /Engine stage failed · plan/ }).first(),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(await aDetails.evaluate((node) => node.scrollTop)).toBe(
    previousScroll,
  );
  await a
    .getByRole('button', { name: 'A event JSON: Raw JSON', exact: true })
    .click();
  await b
    .getByRole('button', { name: 'B event JSON: Raw JSON', exact: true })
    .click();
  await expect(
    a.getByRole('region', { name: 'A event JSON: Raw JSON', exact: true }),
  ).toContainText('b-stage-0');
  await expect(
    b.getByRole('region', { name: 'B event JSON: Raw JSON', exact: true }),
  ).toContainText('a-stage-1');
  await expect(
    page.getByRole('complementary', { name: 'JSON evidence', exact: true }),
  ).toBeHidden();
});

test('long imported identities leave both request details and JSON reachable', async ({
  page,
}) => {
  await openRequestComparisonFixture(page, '?long-identities');
  for (const side of ['A', 'B']) {
    const column = page.getByRole('region', {
      name: `Comparison ${side}`,
      exact: true,
    });
    const details = column.getByRole('region', {
      name: `${side} request details`,
      exact: true,
    });
    const json = column.getByRole('complementary', {
      name: `${side} event JSON`,
      exact: true,
    });
    const columnBox = await column.boundingBox();
    const detailsBox = await details.boundingBox();
    const jsonBox = await json.boundingBox();
    expect(columnBox).not.toBeNull();
    expect(detailsBox).not.toBeNull();
    expect(jsonBox).not.toBeNull();
    if (!columnBox || !detailsBox || !jsonBox) return;
    expect(detailsBox.height).toBeGreaterThan(100);
    expect(jsonBox.y + jsonBox.height).toBeLessThanOrEqual(
      columnBox.y + columnBox.height,
    );
    const tree = column.getByRole('region', {
      name: `${side} event JSON: JSON tree`,
      exact: true,
    });
    expect(await tree.evaluate((node) => node.clientHeight)).toBeGreaterThan(
      90,
    );
    await column
      .getByRole('button', {
        name: `${side} event JSON: Raw JSON`,
        exact: true,
      })
      .click();
    const raw = column.getByRole('region', {
      name: `${side} event JSON: Raw JSON`,
      exact: true,
    });
    expect(await raw.evaluate((node) => node.clientHeight)).toBeGreaterThan(90);
    const identity = column.getByRole('region', {
      name: `${side} request identity`,
      exact: true,
    });
    await identity.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => identity.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(0);
    await expect(json).toContainText('request-');
  }
});

test('long request identities remain readable when horizontal scrolling reserves a gutter', async ({
  page,
}) => {
  await openRequestComparisonFixture(
    page,
    '?long-identities&reserved-scrollbar-space',
  );
  for (const side of ['A', 'B']) {
    const identity = page.getByRole('region', {
      name: `${side} request identity`,
      exact: true,
    });
    const geometry = await identity.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const gutter = Number.parseFloat(getComputedStyle(node).paddingBottom);
      return {
        contentHeight: node.clientHeight - gutter,
        textHeight: range.getBoundingClientRect().height,
        gutter,
      };
    });
    expect(geometry.gutter).toBe(17);
    expect(geometry.contentHeight).toBeGreaterThanOrEqual(geometry.textHeight);
  }
});

test('filtered comparison requests keep their JSON inspectors reachable', async ({
  page,
}) => {
  await openRequestComparisonFixture(page);
  await page
    .getByRole('searchbox', { name: 'Filter diagnostic evidence', exact: true })
    .fill('not-a-retained-request');
  for (const side of ['A', 'B']) {
    const column = page.getByRole('region', {
      name: `Comparison ${side}`,
      exact: true,
    });
    await expect(column).toContainText('hidden from the list');
    const json = column.getByRole('complementary', {
      name: `${side} event JSON`,
      exact: true,
    });
    const columnBox = await column.boundingBox();
    const jsonBox = await json.boundingBox();
    expect(columnBox).not.toBeNull();
    expect(jsonBox).not.toBeNull();
    if (!columnBox || !jsonBox) return;
    expect(jsonBox.y + jsonBox.height).toBeLessThanOrEqual(
      columnBox.y + columnBox.height,
    );
  }
});

test('Connections highlights the connection or voice event shown in JSON', async ({
  page,
}) => {
  await openFixture(page, 'connection-events');
  await page
    .getByRole('combobox', { name: 'Evidence source', exact: true })
    .selectOption('imported');
  await page.getByRole('tab', { name: 'Connections', exact: true }).click();
  await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
  const connection = page.getByRole('button', {
    name: /^Engine connection changed/,
  });
  const voice = page.getByRole('button', { name: /^Voice session changed/ });
  const json = page.getByRole('region', { name: 'Raw JSON', exact: true });
  await connection.click();
  await expect(connection).toHaveAttribute('aria-pressed', 'true');
  await expect(voice).toHaveAttribute('aria-pressed', 'false');
  await expect(json).toContainText('fixture-connection');
  expect(
    await connection.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).not.toBe(
    await voice.evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  await voice.focus();
  await page.keyboard.press('Enter');
  await expect(voice).toHaveAttribute('aria-pressed', 'true');
  await expect(connection).toHaveAttribute('aria-pressed', 'false');
  await expect(json).toContainText('fixture-voice');
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
  await expect(
    panel.locator('[aria-label="JSON evidence"] .json-raw'),
  ).toContainText('before-layout');
  const change = comparison.getByRole('button', {
    name: 'calendar: Moved, Resized, Variant changed',
    exact: true,
  });
  await change.focus();
  await page.keyboard.press('Enter');
  await expect(change).toBeFocused();
  await expect(
    panel.locator('[aria-label="JSON evidence"] .json-raw'),
  ).toContainText('after-layout');
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
