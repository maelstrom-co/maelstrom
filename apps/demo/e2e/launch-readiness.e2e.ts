import { expect, test } from '@playwright/test';

test('serves the hosted VAD runtime instead of the SPA fallback', async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Asset contract is viewport-neutral',
  );
  const documentResponse = await request.get('/');
  expect(documentResponse.headers()['cache-control']).toContain('no-cache');
  expect(documentResponse.headers()['content-security-policy']).toContain(
    "default-src 'self'",
  );
  expect(documentResponse.headers()['content-security-policy']).toContain(
    'wss://*.maelstrom-dev.workers.dev',
  );
  const html = await documentResponse.text();
  const fingerprintedAsset = html.match(/\/assets\/index-[^"']+\.js/)?.[0];
  expect(fingerprintedAsset).toBeDefined();
  const fingerprintedResponse = await request.get(fingerprintedAsset ?? '');
  expect(fingerprintedResponse.headers()['cache-control']).toContain(
    'max-age=31536000',
  );
  const assets = [
    { path: '/vad-web/ort-wasm-simd-threaded.mjs', minBytes: 20_000 },
    { path: '/vad-web/ort-wasm-simd-threaded.wasm', minBytes: 13_000_000 },
    { path: '/vad-web/silero_vad_legacy.onnx', minBytes: 1_700_000 },
    { path: '/vad-web/vad.worklet.bundle.min.js', minBytes: 2_200 },
  ];

  for (const asset of assets) {
    const response = await request.get(asset.path);
    expect(response.ok()).toBe(true);
    expect((await response.body()).byteLength).toBeGreaterThan(asset.minBytes);
    expect(response.headers()['cache-control']).toContain('max-age=3600');
  }
});

test('allows pre-roll AudioWorklet and VAD WebAssembly under hosted CSP', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'AudioWorklet CSP is viewport-neutral',
  );
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    const moduleUrl = URL.createObjectURL(
      new Blob(
        [
          'registerProcessor("maelstrom-csp-probe", class extends AudioWorkletProcessor { process() { return true; } })',
        ],
        { type: 'text/javascript' },
      ),
    );
    try {
      await context.audioWorklet.addModule(moduleUrl);
      await WebAssembly.compile(
        new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      );
      return 'loaded';
    } catch (error) {
      return error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'failed';
    } finally {
      URL.revokeObjectURL(moduleUrl);
      await context.close();
    }
  });

  expect(result).toBe('loaded');
});

test('loads the keyless workspace cleanly without horizontal overflow', async ({
  page,
}) => {
  const consoleProblems: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleProblems.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByText('Interactive preview')).toBeVisible();
  await expect(page.getByLabel('Voice provider')).toHaveValue('live');
  await page.getByLabel('Voice provider').selectOption('realtime');
  await expect(page.getByLabel('Voice provider')).toHaveValue('realtime');
  await expect(page.getByText('DAY VIEW')).toBeVisible();
  await expect(page.getByText('TASKS')).toBeVisible();
  const intentInput = page.getByPlaceholder(
    'Tell Maelstrom what you want to arrange...',
  );
  await expect(intentInput).toBeVisible();
  const inputBounds = await intentInput.boundingBox();
  const viewport = page.viewportSize();
  expect(
    (inputBounds?.y ?? Infinity) + (inputBounds?.height ?? 0),
  ).toBeLessThanOrEqual(viewport?.height ?? 0);
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  const previewBounds = await page.locator('.preview-tasks').boundingBox();
  const composerBounds = await page.locator('.keyless-input').boundingBox();
  expect(
    (previewBounds?.y ?? Infinity) + (previewBounds?.height ?? 0),
  ).toBeLessThanOrEqual(composerBounds?.y ?? 0);
  expect(consoleProblems).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('keeps the interactive Chart nonzero on a short viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({
    width: testInfo.project.name === 'mobile' ? 390 : 1_440,
    height: 300,
  });
  await page.goto('/');
  const apiKeyInput = page.getByRole('textbox', { name: 'API key' });
  if (!(await apiKeyInput.isVisible())) {
    await page.getByRole('button', { name: 'API key' }).click();
  }
  await apiKeyInput.fill('sk-test-short-viewport-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save' }).click();

  const calendar = page.locator('[data-instance-id="calendar-main"]');
  await expect(calendar).toBeAttached();
  expect((await calendar.boundingBox())?.height).toBeGreaterThan(0);
  const composer = page.locator('.connected-input');
  await expect(composer).toBeAttached();
  const composerBounds = await composer.boundingBox();
  expect(
    (composerBounds?.y ?? Infinity) + (composerBounds?.height ?? 0),
  ).toBeLessThanOrEqual(300);
});

test('contains drawer focus and restores the invoking control', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'API key' });
  await trigger.click();
  const input = page.getByRole('textbox', { name: 'API key' });
  await expect(input).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('shows a visible seeded workspace after adding a key', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  const apiKeyInput = page.getByRole('textbox', { name: 'API key' });
  if (!(await apiKeyInput.isVisible())) {
    try {
      await page
        .getByRole('button', { name: 'API key' })
        .click({ timeout: 5_000 });
    } catch (error) {
      if (!(await apiKeyInput.isVisible())) throw error;
    }
  }
  await apiKeyInput.fill('sk-test-launch-readiness-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(
    page.getByRole('status', { name: 'Connection status: connected' }),
  ).toBeVisible();

  const calendar = page.locator('[data-instance-id="calendar-main"]');
  const tasks = page.locator('[data-instance-id="tasks-main"]');
  await expect(calendar).toBeVisible();
  await expect(tasks).toBeVisible();
  const bounds = await calendar.boundingBox();
  expect(bounds?.height).toBeGreaterThan(0);
  const connectedInput = page.getByPlaceholder(
    'Tell Maelstrom what you want to arrange...',
  );
  const voiceOrb = page.getByRole('button', { name: 'Start voice' });
  const orbBounds = await voiceOrb.boundingBox();
  expect(orbBounds?.width).toBeGreaterThanOrEqual(44);
  expect(orbBounds?.height).toBeGreaterThanOrEqual(44);
  const composerBounds = await page.locator('.connected-input').boundingBox();
  const inputBounds = await connectedInput.boundingBox();
  const viewport = page.viewportSize();
  const chartBounds = await page.locator('.chart-wrapper').boundingBox();
  expect(chartBounds?.height).toBeGreaterThan(
    composerBounds?.height ?? Infinity,
  );
  expect(
    (composerBounds?.y ?? Infinity) + (composerBounds?.height ?? 0),
  ).toBeLessThanOrEqual(viewport?.height ?? 0);
  expect(
    (inputBounds?.y ?? Infinity) + (inputBounds?.height ?? 0),
  ).toBeLessThanOrEqual(viewport?.height ?? 0);
  expect(
    consoleErrors.filter(
      (message) =>
        message.includes('Hydration failed') ||
        message.includes('Minified React error #418'),
    ),
  ).toEqual([]);
  expect(
    consoleErrors.filter((message) => message.includes('current.rows')),
  ).toEqual([]);
});
