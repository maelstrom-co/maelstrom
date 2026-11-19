import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { ok, TilingResponseSchema } from '@maelstrom-co/protocol';
import { expect, test } from '@playwright/test';

import { dispatchFrame } from '../src/server/dispatch';

test('applies native Journal writes and Calendar view actions through the hosted shell', async ({
  page,
}) => {
  const errors: string[] = [];
  const actions: string[] = [];
  const vessels = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
  });
  await page.routeWebSocket('**/ws?*', (socket) => {
    let calendar = false;
    let hello = false;
    const engine = createEngine({
      retry: false,
      history: { store: createInMemoryStore(), maxEntries: 20 },
      planner: async ({ request }) => {
        for (const vessel of request.vessels) vessels.add(vessel.id);
        const intent = request.context.updateReasons.find(
          (reason) => reason.type === 'user_intent',
        );
        if (intent?.intent.includes('Show calendar')) calendar = true;
        const showWeek = intent?.intent.includes('Show calendar week view');
        const calendarVariant =
          request.instances.find(
            ({ instanceId }) => instanceId === 'calendar-main',
          )?.variant ?? 'day';
        return ok(
          TilingResponseSchema.parse({
            type: 'plan',
            userMessage: 'Workspace updated',
            rationale: 'Native browser fixture',
            layout: {
              tree: [calendar ? 'ID:calendar-main' : 'ID:preview-entry'],
              instances: [
                calendar
                  ? {
                      instanceId: 'calendar-main',
                      vesselId: 'calendar',
                      variant: calendarVariant,
                    }
                  : {
                      instanceId: 'preview-entry',
                      vesselId: 'journal',
                      variant: 'entry',
                    },
              ],
            },
            executionPlan:
              intent && (!calendar || showWeek)
                ? [
                    calendar
                      ? {
                          instanceId: 'calendar-main',
                          action: 'showWeek',
                          paramsJson: '{}',
                        }
                      : {
                          instanceId: 'preview-entry',
                          action: 'createEntry',
                          paramsJson: '{"title":"Native preview entry"}',
                        },
                  ]
                : [],
          }),
        );
      },
    });
    socket.onMessage(async (raw) => {
      const result = await dispatchFrame(raw, {
        helloReceived: hello,
        wasHelloed: false,
        engineUnavailableReason: '',
        getEngine: () => engine,
      });
      if (result.kind === 'hello') hello = true;
      if (result.kind === 'reply') {
        const reply = JSON.parse(result.wire);
        if (reply.type === 'engine.maelstrom.response') {
          actions.push(
            ...reply.response.executionPlan.map(
              (action: { action: string }) => action.action,
            ),
          );
        }
        socket.send(result.wire);
      }
      if (result.kind === 'close')
        socket.close({ code: result.code, reason: result.reason });
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'API key', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'API key', exact: true })
    .fill('sk-preview-fixture-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'End voice', exact: true }).click();
  const intent = page.getByRole('combobox', {
    name: 'What would you like to do?',
  });
  await intent.fill('Create a Journal entry');
  await intent.press('Enter');
  await expect(
    page.getByText('Native preview entry', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.assistant-response-layer')).toContainText(
    '“Create a Journal entry”: Applied',
  );
  expect([...vessels].sort()).toEqual([
    'calendar',
    'journal',
    'labs',
    'map',
    'tasks',
    'weather',
  ]);
  await intent.fill('Show calendar day view');
  await intent.press('Enter');
  await expect(page.locator('.assistant-response-layer')).toContainText(
    '“Show calendar day view”: Applied',
  );
  await intent.fill('Show calendar week view');
  await intent.press('Enter');
  await expect(page.getByText('Week View', { exact: true })).toBeVisible();
  await expect(page.locator('.assistant-response-layer')).toContainText(
    '“Show calendar week view”: Applied',
  );
  await expect(
    page.getByRole('combobox', { name: 'Voice provider' }),
  ).toBeVisible();
  expect(actions).toEqual(['createEntry', 'showWeek']);
  await page.screenshot({
    path: `tmp/native-workspace-${test.info().project.name}.png`,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});
