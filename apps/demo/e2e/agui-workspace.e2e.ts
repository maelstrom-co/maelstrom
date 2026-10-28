import { AguiWorkspaceSession } from '@maelstrom-co/agui-server';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { ok, TilingResponseSchema } from '@maelstrom-co/protocol';
import { expect, test } from '@playwright/test';
import { dispatchFrame } from '../src/server/dispatch';

test('runs the hosted demo through AG-UI and returns to the normal protocol', async ({
  page,
}) => {
  const errors: string[] = [];
  const operations: string[] = [];
  const vessels = new Set<string>();
  const retired: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // This test verifies the workspace protocol. Native provider audio has a separate live gate.
  await page.route('https://api.openai.com/**', () => {});
  await page.route('**/assets/journal.component-*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  });
  await page.routeWebSocket('**/ws?*', (socket) => {
    const engine = createEngine({
      retry: false,
      history: { store: createInMemoryStore(), maxEntries: 20 },
      planner: async ({ request }) => {
        for (const vessel of request.vessels) vessels.add(vessel.id);
        const task = request.context.updateReasons.some(
          (r) => r.type === 'user_intent',
        );
        return ok(
          TilingResponseSchema.parse({
            userMessage: 'Fixture workspace updated',
            rationale: 'Browser transport fixture',
            layout: {
              tree: ['ID:preview-entry'],
              instances: [
                {
                  instanceId: 'preview-entry',
                  vesselId: 'journal',
                  variant: 'entry',
                },
              ],
            },
            executionPlan: task
              ? [
                  {
                    instanceId: 'preview-entry',
                    action: 'createEntry',
                    paramsJson: '{"title":"AG-UI preview entry"}',
                  },
                ]
              : [],
          }),
        );
      },
    });
    let workspace: AguiWorkspaceSession | undefined;
    let hello = false;
    socket.onClose(() => {
      workspace?.close();
      retired.push(socket.url());
    });
    socket.onMessage(async (raw) => {
      const parsed = JSON.parse(String(raw));
      if (parsed.type === 'demo.agui.run')
        operations.push(parsed.input.forwardedProps.kind);
      const result = await dispatchFrame(raw, {
        helloReceived: hello,
        wasHelloed: false,
        engineUnavailableReason: '',
        getEngine: () => engine,
        workspace: {
          active: () => workspace !== undefined,
          session: (threadId) =>
            (workspace ??= new AguiWorkspaceSession(threadId)),
          send: (event) => socket.send(JSON.stringify(event)),
        },
      });
      if (result.kind === 'hello') hello = true;
      if (result.kind === 'reply') socket.send(result.wire);
      if (result.kind === 'close')
        socket.close({ code: result.code, reason: result.reason });
    });
  });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Workspace protocol' })
    .selectOption('agui');
  await expect(
    page.getByRole('combobox', { name: 'Voice provider' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'API key', exact: true })
    .fill('sk-preview-fixture-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const intent = page.getByPlaceholder(
    'Tell Maelstrom what you want to arrange...',
  );
  await intent.fill('Create a Journal entry');
  await intent.press('Enter');
  await expect(
    page.getByText('AG-UI preview entry', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => operations.filter((op) => op === 'applied').length)
    .toBeGreaterThan(0);
  expect([...vessels].sort()).toEqual([
    'calendar',
    'journal',
    'map',
    'tasks',
    'weather',
  ]);
  await page.screenshot({
    path: `tmp/agui-workspace-${test.info().project.name}.png`,
  });
  const previous = operations.length;
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(() => operations.length).toBeGreaterThan(previous);
  await expect.poll(() => operations.at(-1)).toBe('applied');
  await page
    .getByRole('combobox', { name: 'Workspace protocol' })
    .selectOption('native');
  await expect.poll(() => retired.length).toBeGreaterThan(0);
  await expect(
    page.getByRole('combobox', { name: 'Workspace protocol' }),
  ).toHaveValue('native');
  await expect(intent).toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Voice provider' }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
