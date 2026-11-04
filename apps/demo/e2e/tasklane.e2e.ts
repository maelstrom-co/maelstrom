import {
  type ActionExecution,
  ActionName,
  type ChartRequestMessage,
  decodeClientEnvelope,
  encodeEnvelope,
  InstanceId,
  isOk,
  MaelstromResponseMessage,
} from '@maelstrom-co/protocol';
import { expect, type Locator, type Page, test } from '@playwright/test';

const TASKS = InstanceId('project-tasks-main');
const CREATED = [
  'Explain the host app on the home page',
  'Make task and journal controls interactive',
  'Add a compact weather view',
] as const;
const REASSIGNED = CREATED[1];

// Canned Planner decisions keyed by intent. Tasks are named by id, which is
// how a Planner refers to a record it was shown in the published references.
const PLANS: Readonly<Record<string, readonly ActionExecution[]>> = {
  'Turn this feedback into tasks.': CREATED.map((title) =>
    step('createTask', { title }),
  ),
  'Assign them to me and add them to my priorities.': [
    ...['TL-3', 'TL-4', 'TL-5'].map((task) =>
      step('assignTask', { task, assignee: 'chris' }),
    ),
    ...['TL-3', 'TL-4', 'TL-5'].map((task) =>
      step('addToMyPriorities', { task }),
    ),
  ],
  'Add a description to each of my tasks': [
    step('updateTask', { task: 'TL-3', description: 'Why it matters' }),
    step('updateTask', { task: 'TL-5', description: 'Why it matters' }),
    step('updateTask', {
      task: `TL-4 ${REASSIGNED} (Chris, normal, priority #2)`,
      description: 'Written from a stale view',
    }),
  ],
};

test('runs the feedback-to-priorities journey with factual receipts and a steady dock', async ({
  page,
}) => {
  const requests = await stubPlanner(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'API key' }).click();
  await page
    .getByRole('textbox', { name: 'API key' })
    .fill('sk-test-tasklane-journey-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Update demo README').first()).toBeVisible();

  const dock = page.locator('.tasklane-dock');
  const receipt = page.getByTestId('tasklane-receipt');
  const dockHeight = await heightOf(dock);

  await ask(page, 'Turn this feedback into tasks.');
  await expect(receipt).toHaveText('✓ Created 3 tasks');
  for (const title of CREATED) {
    await expect(
      page.locator('.tasklane-task-title', { hasText: title }),
    ).toBeVisible();
  }
  const resizesBefore = chartResizes(requests);
  expect(await heightOf(dock)).toBe(dockHeight);

  await ask(page, 'Assign them to me and add them to my priorities.');
  await expect(receipt).toHaveText(
    '✓ Assigned 3 tasks to Chris · ✓ Added 3 tasks to your priorities',
  );
  for (const [index, title] of CREATED.entries()) {
    await expect(
      page
        .locator('.tasklane-task-body', { hasText: title })
        .locator('.tasklane-priority-badge'),
    ).toHaveText(`★${index + 1}`);
  }

  const assignee = page.getByRole('combobox', {
    name: `Assignee for ${REASSIGNED}`,
  });
  await assignee.focus();
  await page.keyboard.type('Alex');
  await expect(assignee).toHaveValue('alex');
  await expect(receipt).toHaveText(`✓ Reassigned "${REASSIGNED}" to Alex`);

  await ask(page, 'Add a description to each of my tasks');
  await expect(receipt).toHaveText(
    `✗ Couldn't update "${REASSIGNED}" because it changed: now Alex, normal, priority #2 · ✓ Updated 2 descriptions`,
  );
  await expect(page.getByText('Written from a stale view')).toHaveCount(0);

  expect(await heightOf(dock)).toBe(dockHeight);
  expect(chartResizes(requests)).toBe(resizesBefore);
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test('explains Tasklane before the key step without horizontal overflow', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/tasks');

  await expect(page).toHaveTitle('Tasklane, powered by Maelstrom');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Tasklane' }),
  ).toBeVisible();
  await expect(page.getByText('Powered by Maelstrom')).toBeVisible();

  const intro = page.getByRole('region', { name: 'About Tasklane' });
  await expect(intro).toContainText(
    'Tasklane is a sample task app with Maelstrom built in.',
  );
  await expect(intro).toContainText(
    'Tasklane, the host app, supplies the Vessels (its views) and the Actions they offer.',
  );
  await expect(intro).toContainText(
    'not a live ClickUp, Jira or Todoist integration',
  );
  await expect(intro).toContainText('Works today:');
  await expect(intro).toContainText('In development:');
  await expect(
    page.getByRole('button', { name: 'Start interactive demo' }),
  ).toBeVisible();
  await expect(page.locator('#tasklane-intent')).toBeVisible();

  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  expect(errors).toEqual([]);
});

test('keeps the home page title and gives no home link to Tasklane', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).not.toHaveTitle(/Tasklane/);
  await expect(page.locator('a[href="/tasks"]')).toHaveCount(0);
});

function step(
  action: string,
  params: Record<string, unknown>,
): ActionExecution {
  return { instanceId: TASKS, action: ActionName(action), params };
}

async function stubPlanner(page: Page): Promise<ChartRequestMessage[]> {
  const requests: ChartRequestMessage[] = [];
  await page.routeWebSocket('**/ws?*', (socket) => {
    socket.onMessage((raw) => {
      const frame = decodeClientEnvelope(raw);
      if (!isOk(frame) || frame.value.type !== 'chart_request') return;
      const request = frame.value;
      requests.push(request);
      const intent = request.request.context.updateReasons.find(
        (reason) => reason.type === 'user_intent',
      );
      // The demo connector appends browser context after the typed text.
      const typed =
        intent?.type === 'user_intent'
          ? Object.keys(PLANS).find((known) => intent.intent.startsWith(known))
          : undefined;
      const executionPlan = typed ? (PLANS[typed] ?? []) : [];
      socket.send(
        encodeEnvelope(
          MaelstromResponseMessage({
            requestId: request.id,
            sessionId: request.sessionId,
            response: {
              type: 'maelstrom_response',
              requestId: request.id,
              userMessage: '',
              rationale: '',
              executionPlan: [...executionPlan],
              layout: request.request.layout,
            },
          }),
        ),
      );
    });
  });
  return requests;
}

async function ask(page: Page, intent: string): Promise<void> {
  const input = page.locator('#tasklane-intent');
  await input.fill(intent);
  await input.press('Enter');
}

async function heightOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not visible');
  return box.height;
}

function chartResizes(requests: readonly ChartRequestMessage[]): number {
  return requests.filter((request) =>
    request.request.context.updateReasons.some(
      (reason) => reason.type === 'chart_resize',
    ),
  ).length;
}
