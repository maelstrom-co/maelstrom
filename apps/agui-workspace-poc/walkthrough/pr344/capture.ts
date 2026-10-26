import { resolve } from 'node:path';
import { createEngine } from '@maelstrom-co/engine';
import { ok, TilingResponseSchema } from '@maelstrom-co/protocol';
import { chromium, expect } from '@playwright/test';
import { AguiWorkspaceSession } from '../../../../packages/agui-server/src/server';
import { dispatchFrame } from '../../../demo/src/server/dispatch';

const root = resolve(import.meta.dirname, '../../../..');
const server = Bun.spawn(
  [process.execPath, '--no-env-file', 'run', 'scripts/hosted-e2e-server.ts'],
  {
    cwd: resolve(root, 'apps/demo'),
    env: { ...process.env, HOSTED_E2E_PORT: '4189' },
    stdout: 'ignore',
    stderr: 'ignore',
  },
);
const browser = await chromium.launch();
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      await fetch('http://127.0.0.1:4189/')
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    await Bun.sleep(100);
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://api.openai.com/**', () => {});
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  });
  await page.routeWebSocket('**/ws?*', (socket) => {
    const engine = createEngine({
      retry: false,
      planner: async ({ request }) =>
        ok(
          TilingResponseSchema.parse({
            userMessage: 'Fixture workspace updated',
            rationale: 'Deterministic protocol comparison',
            layout: {
              tree: ['ID:review-entry'],
              instances: [
                {
                  instanceId: 'review-entry',
                  vesselId: 'journal',
                  variant: 'entry',
                },
              ],
            },
            executionPlan: request.context.updateReasons.some(
              (reason) => reason.type === 'user_intent',
            )
              ? [
                  {
                    instanceId: 'review-entry',
                    action: 'createEntry',
                    paramsJson: '{"title":"Protocol review"}',
                  },
                ]
              : [],
          }),
        ),
    });
    let workspace: AguiWorkspaceSession | undefined;
    let hello = false;
    socket.onClose(() => workspace?.close());
    socket.onMessage(async (raw) => {
      const result = await dispatchFrame(raw, {
        helloReceived: hello,
        wasHelloed: false,
        engineUnavailableReason: '',
        getEngine: () => engine,
        workspace: {
          active: () => workspace !== undefined,
          session: (id) => {
            workspace ??= new AguiWorkspaceSession(id);
            return workspace;
          },
          send: (event) => socket.send(JSON.stringify(event)),
        },
      });
      if (result.kind === 'hello') hello = true;
      if (result.kind === 'reply') socket.send(result.wire);
      if (result.kind === 'close')
        socket.close({ code: result.code, reason: result.reason });
    });
  });
  await page.goto('http://127.0.0.1:4189/');
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'API key', exact: true })
    .fill('sk-video-fixture-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Workspace protocol' });
  await selector.selectOption('agui');
  for (const mode of ['native', 'agui']) {
    await selector.selectOption(mode);
    await expect(page.locator('button.voice-orb')).toHaveAttribute(
      'data-state',
      'idle',
    );
    const input = page.getByPlaceholder(
      'Tell Maelstrom what you want to arrange...',
    );
    await input.fill('Create a Journal entry titled Protocol review.');
    await input.press('Enter');
    await expect(
      page.getByText('Protocol review', { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: resolve(import.meta.dirname, `assets/${mode}.png`),
    });
    await page.screenshot({
      path: resolve(import.meta.dirname, `assets/${mode}-header.png`),
      clip: { x: 710, y: 0, width: 720, height: 100 },
    });
  }
  expect(errors).toEqual([]);
  console.log(
    'Captured native and AG-UI fixture workspaces; zero page errors.',
  );
} finally {
  await browser.close();
  server.kill();
  await server.exited;
}
