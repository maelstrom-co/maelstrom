// @vitest-environment happy-dom

import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  type VesselDefinition,
} from '@maelstrom-co/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';
import { tasklaneM } from './maelstrom';
import { __resetFeedbackStoreForTests } from './stores/feedback.store';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  type ProjectTask,
  projectTaskActions,
  taskReferenceLabel,
} from './stores/project-tasks.store';
import { __resetTasklaneActivityForTests } from './tasklane-activity';

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));

vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class {
    activateAudio() {}
  },
}));

vi.mock('../lib/mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

vi.mock('../lib/hosted-vad', () => ({
  HOSTED_VAD_MODEL: 'legacy',
  preloadHostedVadAssets: async () => {},
}));

// Stands in for the Engine and Planner: each known intent gets the Execution
// Plan a Planner would return, built from the references it was shown.
const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  plans: new Map<string, () => ExecutionPlan>(),
}));

vi.mock('../lib/connector', () => ({
  createDemoConnector: () => ({
    ...createMockConnector(),
    process: async (message: ChartRequestMessage) => {
      engine.requests.push(message);
      return cannedResponse(message);
    },
  }),
}));

type ExecutionPlan = MaelstromResponse['executionPlan'];

const TASKS = InstanceId('project-tasks-main');
const NEW_TASKS = [
  'Explain the host app on the home page',
  'Make task and journal controls interactive',
  'Add a compact weather view',
  'Use the pet shop as the example app',
] as const;

class LayoutHostResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    if (!target.classList.contains('demo-layout-host')) return;
    this.callback(
      [
        {
          target,
          contentRect: { width: 1440, height: 900 },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  selectVoiceProvider('realtime');
  vi.stubEnv('VITE_HOSTED', '1');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  FakeRealtimeSession.instances = [];
  engine.requests = [];
  engine.plans = new Map();
  clearPlaygroundKey();
  resetTasklane();
  vi.stubGlobal('ResizeObserver', LayoutHostResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPlaygroundKey();
  resetTasklane();
});

describe('Tasklane journey from feedback to my priorities', () => {
  it('turns feedback into grouped, scoped, assigned tasks and respects a manual reassignment', async () => {
    const updateVesselSpy = vi.spyOn(tasklaneM, 'updateVessel');
    setPlaygroundKey('sk-tasklane-journey-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    await waitFor(() =>
      expect(acceptedDescription(updateVesselSpy, 'source-feedback')).toContain(
        'real layout tool',
      ),
    );

    // 1. Turn this feedback into tasks.
    engine.plans.set('Turn this feedback into tasks.', () =>
      plan(...NEW_TASKS.map((title) => ['createTask', { title }] as const)),
    );
    await ask('Turn this feedback into tasks.');
    await expectReceipt('✓ Created 4 tasks');
    expect(titles()).toEqual([
      'Update demo README',
      'Record launch video',
      ...NEW_TASKS,
    ]);
    for (const title of NEW_TASKS) expect(taskRow(title)).toBeTruthy();

    // 2. Actually, group those under one parent.
    engine.plans.set('Actually, group those under one parent.', () =>
      plan(
        ['createTask', { title: 'Improve the demo' }],
        ...NEW_TASKS.map(
          (title) =>
            [
              'setParent',
              { task: label(title), parent: 'Improve the demo' },
            ] as const,
        ),
      ),
    );
    await ask('Actually, group those under one parent.');
    await expectReceipt(
      '✓ Created "Improve the demo" · ✓ Grouped 4 tasks under "Improve the demo"',
    );
    const parent = task('Improve the demo');
    for (const title of NEW_TASKS) {
      expect(task(title).parentId).toBe(parent.id);
      expect(taskRow(title).getAttribute('data-depth')).toBe('1');
    }

    // 3. The pet shop isn't ready. Keep this focused on the existing demo.
    engine.plans.set(
      "The pet shop isn't ready. Keep this focused on the existing demo.",
      () =>
        plan(
          [
            'removeTask',
            { task: label('Use the pet shop as the example app') },
          ],
          [
            'updateTask',
            {
              task: label('Improve the demo'),
              description: 'Focus on the existing day planner demo.',
            },
          ],
          [
            'updateTask',
            {
              task: label('Explain the host app on the home page'),
              description: 'Use the day planner as the host app example.',
            },
          ],
        ),
    );
    await ask(
      "The pet shop isn't ready. Keep this focused on the existing demo.",
    );
    await expectReceipt(
      '✓ Deleted "Use the pet shop as the example app" · ✓ Updated 2 descriptions',
    );
    expect(titles()).not.toContain('Use the pet shop as the example app');
    expect(task('Improve the demo').description).toBe(
      'Focus on the existing day planner demo.',
    );

    // 4. Assign them to me and add them to my priorities.
    const mine = [
      'Improve the demo',
      'Explain the host app on the home page',
      'Make task and journal controls interactive',
      'Add a compact weather view',
    ];
    engine.plans.set('Assign them to me and add them to my priorities.', () => {
      const labels = mine.map(label);
      return plan(
        ...labels.map(
          (task) => ['assignTask', { task, assignee: 'chris' }] as const,
        ),
        ...labels.map((task) => ['addToMyPriorities', { task }] as const),
      );
    });
    await ask('Assign them to me and add them to my priorities.');
    await expectReceipt(
      '✓ Assigned 4 tasks to Chris · ✓ Added 4 tasks to your priorities',
    );
    for (const title of mine) {
      expect(task(title)).toMatchObject({
        assigneeId: 'chris',
        urgency: 'normal',
      });
    }
    expect(getProjectTasksSnapshot().myPriorities).toEqual(
      mine.map((title) => task(title).id),
    );
    expect(
      mine.map(
        (title) =>
          taskRow(title).querySelector('.tasklane-priority-badge')?.textContent,
      ),
    ).toEqual(mine.map((_, i) => `★${i + 1}`));

    // 5. Reassign one task to Alex by hand, then ask about "my tasks".
    const reassigned = 'Make task and journal controls interactive';
    const labelBeforeReassignment = label(reassigned);
    await act(async () => {
      fireEvent.change(
        screen.getByRole('combobox', { name: `Assignee for ${reassigned}` }),
        { target: { value: 'alex' } },
      );
    });
    await expectReceipt(`✓ Reassigned "${reassigned}" to Alex`);
    await waitFor(() =>
      expect(
        acceptedEnum(updateVesselSpy, 'project-tasks', 'assignTask', 'task'),
      ).toContain(
        `${task(reassigned).id} ${reassigned} (Alex, normal, priority #3)`,
      ),
    );
    expect(acceptedDescription(updateVesselSpy, 'project-tasks')).toContain(
      `${task(reassigned).id} "${reassigned}": parent ${parent.id}, assignee Alex`,
    );

    const stillMine = mine.filter((title) => title !== reassigned);
    engine.plans.set('Add a description to each of my tasks', () =>
      plan(
        ...stillMine.map(
          (title) =>
            [
              'updateTask',
              { task: label(title), description: `Why: ${title}` },
            ] as const,
        ),
        [
          'updateTask',
          { task: labelBeforeReassignment, description: 'Stale plan' },
        ],
      ),
    );
    await ask('Add a description to each of my tasks');
    await expectReceipt(
      `✗ Couldn't update "${reassigned}" because it changed: now Alex, normal, priority #3 · ✓ Updated 3 descriptions`,
    );
    for (const title of stillMine) {
      expect(task(title).description).toBe(`Why: ${title}`);
    }
    expect(task(reassigned)).toMatchObject({
      assigneeId: 'alex',
      description: '',
    });
    expect(receipt().getAttribute('data-tone')).toBe('problem');
  });

  it('shows no receipt for a layout-only response and keeps the band in place', async () => {
    setPlaygroundKey('sk-tasklane-layout-only-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });

    engine.plans.set('Turn this feedback into tasks.', () =>
      plan(['createTask', { title: 'Only one' }]),
    );
    await ask('Turn this feedback into tasks.');
    await expectReceipt('✓ Created "Only one"');

    engine.plans.set('Give the tasks more room', () => []);
    await ask('Give the tasks more room');
    await waitFor(() => expect(receipt().textContent).toBe(''));
    expect(receipt().isConnected).toBe(true);
  });

  it('refuses a planned change to a task edited by hand while the Planner was working', async () => {
    setPlaygroundKey('sk-tasklane-edit-during-plan-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });

    engine.plans.set('Make the README urgent', () => {
      const seenByPlanner = label('Update demo README');
      projectTaskActions.assignTask('TL-1', 'sam');
      return plan(['setUrgency', { task: seenByPlanner, urgency: 'high' }]);
    });
    await ask('Make the README urgent');

    await waitFor(() =>
      expect(receipt().getAttribute('data-tone')).toBe('problem'),
    );
    expect(receipt().textContent).toContain(
      'Couldn\'t change the urgency of "Update demo README" because it changed',
    );
    expect(task('Update demo README')).toMatchObject({
      assigneeId: 'sam',
      urgency: 'normal',
    });
  });

  it('marks a planned Action that never ran as not confirmed', async () => {
    setPlaygroundKey('sk-tasklane-unconfirmed-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });

    engine.plans.set('Assign the README to Sam', () => [
      {
        instanceId: InstanceId('project-tasks-missing'),
        action: ActionName('assignTask'),
        params: { task: 'TL-1', assignee: 'sam' },
      },
    ]);
    await ask('Assign the README to Sam');
    await expectReceipt('? Not confirmed: assign a task', 10_000);
    expect(getProjectTasksSnapshot().tasks[0]?.assigneeId).toBe('alex');
  }, 20_000);
});

function cannedResponse(message: ChartRequestMessage): MaelstromResponse {
  const intent = message.request.context.updateReasons.find(
    (reason) => reason.type === 'user_intent',
  );
  const planFor =
    intent?.type === 'user_intent'
      ? engine.plans.get(intent.intent)
      : undefined;
  return {
    type: 'maelstrom_response',
    requestId: message.id,
    userMessage: 'Done.',
    rationale: '',
    executionPlan: planFor?.() ?? [],
    layout: message.request.layout,
  };
}

function plan(
  ...steps: readonly (readonly [string, Record<string, unknown>])[]
): ExecutionPlan {
  return steps.map(([action, params]) => ({
    instanceId: TASKS,
    action: ActionName(action),
    params,
  }));
}

async function ask(intent: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Ask Tasklane'), {
    target: { value: intent },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

async function expectReceipt(text: string, timeout = 3000): Promise<void> {
  await waitFor(() => expect(receipt().textContent).toBe(text), { timeout });
  expect(receipt().getAttribute('title')).toBe(text);
}

function receipt(): HTMLElement {
  return screen.getByTestId('tasklane-receipt');
}

function task(title: string): ProjectTask {
  const found = getProjectTasksSnapshot().tasks.find(
    (candidate) => candidate.title === title,
  );
  if (!found) throw new Error(`no task titled ${title}`);
  return found;
}

function label(title: string): string {
  return taskReferenceLabel(task(title));
}

function titles(): string[] {
  return getProjectTasksSnapshot().tasks.map((candidate) => candidate.title);
}

function taskRow(title: string): HTMLElement {
  const row = screen
    .getAllByRole('listitem')
    .find(
      (item) =>
        item.hasAttribute('data-depth') &&
        item.querySelector('.tasklane-task-title')?.textContent === title,
    );
  if (!row) throw new Error(`no task row titled ${title}`);
  return row;
}

interface UpdateVesselSpy {
  mock: { calls: unknown[][]; results: { value: unknown }[] };
}

function acceptedVessel(
  spy: UpdateVesselSpy,
  vesselId: string,
): VesselDefinition | undefined {
  const accepted = spy.mock.calls.filter(
    ([vessel], i) =>
      (vessel as VesselDefinition).id === vesselId &&
      (spy.mock.results[i]?.value as { ok?: boolean } | undefined)?.ok === true,
  );
  return accepted.at(-1)?.[0] as VesselDefinition | undefined;
}

function acceptedDescription(spy: UpdateVesselSpy, vesselId: string): string {
  return acceptedVessel(spy, vesselId)?.description ?? '';
}

function acceptedEnum(
  spy: UpdateVesselSpy,
  vesselId: string,
  action: string,
  parameter: string,
): readonly unknown[] {
  const vessel = acceptedVessel(spy, vesselId);
  for (const variant of Object.values(vessel?.variants ?? {})) {
    const found = variant.actions
      .find((candidate) => candidate.name === action)
      ?.parameters?.find((candidate) => candidate.name === parameter);
    if (found) return found.enum ?? [];
  }
  return [];
}

function resetTasklane(): void {
  __resetFeedbackStoreForTests();
  __resetProjectTasksStoreForTests();
  __resetTasklaneActivityForTests();
}
