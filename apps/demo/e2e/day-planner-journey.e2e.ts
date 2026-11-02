import {
  type ActionExecution,
  ActionName,
  decodeClientEnvelope,
  encodeEnvelope,
  InstanceId,
  isOk,
  MaelstromResponseMessage,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { expect, type Page, test } from '@playwright/test';

const TASKS = InstanceId('tasks-main');
const JOURNAL = InstanceId('journal-main');

const TASKS_INSTANCE = {
  instanceId: TASKS,
  vesselId: VesselId('tasks'),
  variant: VariantName('list'),
};

const TASKS_ONLY: TilingLayout = {
  type: 'tiling',
  tree: ['ID:tasks-main'],
  instances: [TASKS_INSTANCE],
};

// The list step shows the journal alone, as a Planner would on a phone, so
// its inline editor has room above the floating Maelstrom response.
function withJournal(variant: 'entry' | 'list'): TilingLayout {
  return {
    type: 'tiling',
    tree:
      variant === 'entry'
        ? ['H', 'ID:tasks-main', 'ID:journal-main']
        : ['ID:journal-main'],
    instances: [
      TASKS_INSTANCE,
      {
        instanceId: JOURNAL,
        vesselId: VesselId('journal'),
        variant: VariantName(variant),
      },
    ],
  };
}

interface CannedTurn {
  readonly layout: TilingLayout;
  readonly executionPlan: readonly ActionExecution[];
  readonly userMessage: string;
}

const TURNS: ReadonlyArray<readonly [RegExp, CannedTurn]> = [
  [
    /design review, with subtasks/,
    {
      layout: TASKS_ONLY,
      userMessage: 'Added the design review task.',
      executionPlan: [
        {
          instanceId: TASKS,
          action: ActionName('addTask'),
          params: {
            title: 'Prepare design review',
            subtasks: 'Check prototype | Write questions',
          },
        },
      ],
    },
  ],
  [
    /journal entry called Design review prep/,
    {
      layout: withJournal('entry'),
      userMessage: 'Started the entry.',
      executionPlan: [
        {
          instanceId: JOURNAL,
          action: ActionName('createEntry'),
          params: { title: 'Design review prep' },
        },
        {
          instanceId: JOURNAL,
          action: ActionName('writeContent'),
          params: { text: 'Prototype checked; questions still to prepare.' },
        },
      ],
    },
  ],
  [
    /journal list/,
    {
      layout: withJournal('list'),
      userMessage: 'Showing the journal list.',
      executionPlan: [],
    },
  ],
];

test('completes the day-planner journey across conversation and clicks', async ({
  page,
}) => {
  const resizeRequests: number[] = [];
  let currentLayout: TilingLayout | null = null;

  await page.routeWebSocket('**/ws?*', (socket) => {
    socket.onMessage((raw) => {
      const frame = decodeClientEnvelope(raw);
      if (!isOk(frame) || frame.value.type !== 'chart_request') return;
      const request = frame.value;
      const reasons = request.request.context.updateReasons;
      if (reasons.some((reason) => reason.type === 'chart_resize')) {
        resizeRequests.push(Date.now());
      }
      const intent = [...reasons]
        .reverse()
        .find((reason) => reason.type === 'user_intent');
      const turn =
        intent?.type === 'user_intent'
          ? TURNS.find(([pattern]) => pattern.test(intent.intent))?.[1]
          : undefined;
      if (turn) currentLayout = turn.layout;
      const layout = currentLayout ?? request.request.layout;
      socket.send(
        encodeEnvelope(
          MaelstromResponseMessage({
            requestId: request.id,
            sessionId: request.sessionId,
            response: {
              type: 'maelstrom_response',
              requestId: request.id,
              userMessage: turn?.userMessage ?? '',
              rationale: '',
              executionPlan: turn?.executionPlan ?? [],
              layout,
            },
          }),
        ),
      );
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'API key' }).click();
  await page
    .getByRole('textbox', { name: 'API key' })
    .fill('sk-test-day-planner-not-a-real-key-1234567890');
  await page.getByRole('button', { name: 'Save' }).click();

  const receipt = page.getByTestId('action-receipt-line');
  const dock = page.locator('.connected-input');
  await expect(receipt).toBeAttached();
  await expect(receipt).toHaveText('');
  const dockHeight = await heightOf(page, '.connected-input');

  const send = async (text: string) => {
    const input = page.locator('#demo-intent');
    await input.fill(text);
    await input.press('Enter');
  };

  // Step 1: a request adds the task with both subtasks.
  await send(
    'Add a task to prepare the design review, with subtasks for checking the prototype and writing questions.',
  );
  await expect(receipt).toHaveText(
    '✓ Added "Prepare design review" with 2 subtasks',
  );
  // The first request carries the initial Chart measurement, so its own
  // chart_resize is expected and the baseline starts after it.
  await expectStableDock(
    page,
    dockHeight,
    resizeRequests,
    resizeRequests.length,
  );

  // Step 2: a direct click checks a subtask through the same Action.
  const subtask = page.getByRole('checkbox', {
    name: 'Check prototype',
  });
  await expect(subtask).not.toBeChecked();
  let before = resizeRequests.length;
  await subtask.focus();
  await page.keyboard.press('Space');
  await expect(subtask).toBeChecked();
  await expect(receipt).toHaveText('✓ Checked subtask "Check prototype"');
  await expectStableDock(page, dockHeight, resizeRequests, before);

  // Step 3: a request creates and writes a journal entry.
  before = resizeRequests.length;
  await send(
    "Create a journal entry called Design review prep and write 'Prototype checked; questions still to prepare.'",
  );
  await expect(receipt).toHaveText(
    '✓ Created journal entry "Design review prep" · ✓ Wrote to "Design review prep"',
  );
  await expect(page.getByLabel('Text of Design review prep')).toHaveValue(
    'Prototype checked; questions still to prepare.',
  );
  await expectStableDock(page, dockHeight, resizeRequests, before);

  // A layout-only request shows no receipt line.
  await send('Show the journal list');
  const row = page.getByRole('button', { name: /Design review prep/ });
  await expect(row).toBeVisible();
  await expect(receipt).toHaveText('');

  // Step 4: open an entry by keyboard, edit it and save.
  before = resizeRequests.length;
  // The entry just written stays selected, so the list opens it already.
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const editor = page.getByLabel('Text of Design review prep');
  await editor.fill('Prototype checked. Questions drafted for the review.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(receipt).toHaveText(
    '✓ Updated journal entry "Design review prep"',
  );
  await expect(row).toBeFocused();
  await expectStableDock(page, dockHeight, resizeRequests, before);
  await expect(dock).toBeVisible();
});

async function heightOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no layout box`);
  return box.height;
}

// A receipt must never grow the dock, which would resize the Chart and send
// a chart_resize request.
async function expectStableDock(
  page: Page,
  dockHeight: number,
  resizeRequests: number[],
  before: number,
): Promise<void> {
  expect(resizeRequests.length).toBe(before);
  expect(await heightOf(page, '.connected-input')).toBe(dockHeight);
  await page.waitForTimeout(600);
  expect(resizeRequests.length).toBe(before);
  expect(await heightOf(page, '.connected-input')).toBe(dockHeight);
}
