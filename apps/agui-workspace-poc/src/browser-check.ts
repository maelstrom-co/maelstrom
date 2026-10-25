import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const output = new URL('../../../tmp/research/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const approvalMode = process.env.APPROVAL === '1';
const denied = process.env.DENY === '1';
const label = approvalMode ? (denied ? 'deny' : 'approve') : 'browser';
const server = process.env.POC_URL
  ? undefined
  : Bun.spawn(
      [
        'bun',
        '--conditions=@maelstrom-co/source',
        new URL('./browser-server.ts', import.meta.url).pathname,
      ],
      { env: { ...process.env, PORT: '0' }, stdout: 'pipe', stderr: 'inherit' },
    );
try {
  let url = process.env.POC_URL;
  if (server) {
    const reader = server.stdout.getReader();
    const first = await reader.read();
    reader.releaseLock();
    url = new TextDecoder()
      .decode(first.value)
      .match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
  }
  if (!url) throw new Error('Browser server did not report its URL');
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1100 },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text());
  });
  await page.goto(url);
  await expect(
    page.getByRole('button', { name: 'Run one goal' }),
  ).toBeEnabled();
  await page.screenshot({ path: `${output}/agui-${label}-before.png` });
  await page.getByRole('button', { name: 'Run one goal' }).click();
  if (approvalMode) {
    await expect(page.getByRole('status')).toHaveText('Awaiting approval');
    await expect(page.getByTestId('focus')).toHaveText('Waiting for focus');
    await expect(page.getByTestId('record')).not.toHaveText('No record');
    await page.screenshot({ path: `${output}/agui-${label}-waiting.png` });
    await page
      .getByRole('button', { name: denied ? 'Deny read' : 'Allow read' })
      .click();
  }
  await expect(page.getByRole('status')).toHaveText(
    denied ? 'Stopped: read denied' : 'Complete',
  );
  await expect(page.getByTestId('focus')).toHaveText(
    denied ? 'Waiting for focus' : 'Focused exact ID and version',
  );
  const evidence = JSON.parse(await page.getByTestId('evidence').innerText());
  expect(evidence.creates).toBe(1);
  expect(evidence.focused).toEqual(denied ? undefined : evidence.record);
  expect(evidence.commands).toEqual(
    denied
      ? ['set_layout', 'execute_actions']
      : ['set_layout', 'execute_actions', 'set_layout', 'execute_actions'],
  );
  expect(evidence.snapshot.chartDimensions).toEqual({ columns: 12, rows: 8 });
  const box = await page
    .getByRole('region', { name: 'Notes Vessel' })
    .boundingBox();
  expect(box?.width).toBeGreaterThan(900);
  expect(box?.height).toBeGreaterThan(580);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${output}/agui-${label}-after.png` });
  await Bun.write(
    `${output}/agui-${label}-evidence.json`,
    JSON.stringify({ evidence, box, errors }, null, 2),
  );
  console.log(
    `Verified ${label}: real Chart, Action ordering, approval policy, and 12×8 container measurement.`,
  );
} finally {
  await browser.close();
  server?.kill();
  if (server) await server.exited;
}
