// @vitest-environment happy-dom

import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import type { RealtimeInstance } from '@maelstrom-co/realtime';
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
import { __resetClickReceiptsForTests } from '../lib/click-receipt';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';
import { __resetBoardFilterStoreForTests } from './stores/board-filter.store';
import { __resetFeedbackStoreForTests } from './stores/feedback.store';
import { __resetFlexibleTableStoreForTests } from './stores/flexible-table.store';
import {
  __resetProjectTasksStoreForTests,
  projectTaskActions,
} from './stores/project-tasks.store';
import { __resetTaskDetailStoreForTests } from './stores/task-detail.store';

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

const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  plans: new Map<string, () => MaelstromResponse['executionPlan']>(),
  layouts: new Map<string, TilingLayout>(),
}));

vi.mock('../lib/connector', () => ({
  createDemoConnector: () => ({
    ...createMockConnector(),
    process: async (message: ChartRequestMessage) => {
      engine.requests.push(message);
      const intent = message.request.context.updateReasons.find(
        (reason) => reason.type === 'user_intent',
      );
      const text = intent?.type === 'user_intent' ? intent.intent : undefined;
      return {
        type: 'maelstrom_response' as const,
        requestId: message.id,
        userMessage: 'Done.',
        rationale: '',
        executionPlan: (text ? engine.plans.get(text)?.() : undefined) ?? [],
        layout: (text && engine.layouts.get(text)) || message.request.layout,
      };
    },
  }),
}));

const FEEDBACK = InstanceId('source-feedback-main');
const TASKS = InstanceId('project-tasks-main');
const TABLE = InstanceId('flexible-table-main');

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
  engine.layouts = new Map();
  clearPlaygroundKey();
  resetStores();
  vi.stubGlobal('ResizeObserver', LayoutHostResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPlaygroundKey();
  resetStores();
});

describe('Flexible table journey and voice path', () => {
  it('runs addColumn then sortBy on the new column in a single response', async () => {
    setPlaygroundKey('sk-tasklane-table-journey-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });

    const intent =
      'Add a column that sums estimate and spent and sort by it descending';
    engine.layouts.set(intent, layoutWithTable());
    engine.plans.set(intent, () => [
      {
        instanceId: TABLE,
        action: ActionName('addColumn'),
        params: {
          label: 'Total',
          kind: 'computed',
          formula: 'estimate + spent',
        },
      },
      {
        instanceId: TABLE,
        action: ActionName('sortBy'),
        params: {
          column: 'Total',
          direction: 'desc',
          add: false,
        },
      },
    ]);

    await askTyped(intent);

    const table = await screen.findByRole(
      'table',
      { name: 'Flexible table' },
      { timeout: 3000 },
    );

    await waitFor(() => {
      const rows = [...table.querySelectorAll('tbody tr[data-task-id]')];
      expect(rows.map((r) => r.getAttribute('data-task-id'))).toEqual([
        'TL-2',
        'TL-1',
      ]);
      expect(
        rows.map(
          (r) => r.querySelector('td[data-column-id="total"]')?.textContent,
        ),
      ).toEqual(['7', '3']);
    });
  }, 15_000);

  it('reports a failed table Action on the receipt line through the request outcome', async () => {
    setPlaygroundKey('sk-tasklane-table-receipt-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });

    const intent = 'Sort the table by a column that does not exist';
    engine.layouts.set(intent, layoutWithTable());
    engine.plans.set(intent, () => [
      {
        instanceId: TABLE,
        action: ActionName('sortBy'),
        params: { column: 'Nope', direction: 'desc', add: false },
      },
    ]);

    await askTyped(intent);

    await waitFor(
      () =>
        expect(screen.getByTestId('tasklane-receipt').textContent).toBe(
          '✗ Couldn\'t update the table: Unknown column "Nope". Current columns: id (ID), title (Title), assignee (Assignee), status (Status), urgency (Urgency), estimate (Estimate), spent (Spent).',
        ),
      { timeout: 10_000 },
    );
    expect(
      screen.getByTestId('tasklane-receipt').getAttribute('data-tone'),
    ).toBe('problem');
  }, 15_000);

  it('reaches the same flexible-table Action handlers through the voice realtime session', async () => {
    projectTaskActions.createTask({
      title: 'Wire voice table',
      assignee: 'alex',
      urgency: 'high',
    }); // TL-3
    projectTaskActions.setStatus('TL-3', 'doing');

    setPlaygroundKey('sk-tasklane-table-voice-1234567890');
    const { TasklanePage } = await import('./tasklane-page');
    render(<TasklanePage />);
    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });

    const intent = "Show only Alex's doing tasks";
    engine.layouts.set(intent, layoutWithTable());
    engine.plans.set(intent, () => [
      {
        instanceId: TABLE,
        action: ActionName('filterRows'),
        params: { column: 'assignee', op: 'eq', value: 'alex' },
      },
      {
        instanceId: TABLE,
        action: ActionName('filterRows'),
        params: { column: 'status', op: 'eq', value: 'doing' },
      },
    ]);

    const session = FakeRealtimeSession.instances.at(-1);
    if (!session) throw new Error('Expected a RealtimeSession instance');
    const voiceInstance = (session.options as { instance: RealtimeInstance })
      .instance;

    expect(
      voiceInstance
        .getCapabilitySnapshot()
        .vessels.map((vessel) => vessel.vesselId),
    ).toContain('flexible-table');

    await act(async () => {
      await voiceInstance.submitIntent(intent);
    });

    const table = await screen.findByRole(
      'table',
      { name: 'Flexible table' },
      { timeout: 3000 },
    );
    await waitFor(() => {
      const rows = [...table.querySelectorAll('tbody tr[data-task-id]')];
      expect(rows.map((r) => r.getAttribute('data-task-id'))).toEqual(['TL-3']);
    });
  });
});

function layoutWithTable(): TilingLayout {
  return {
    type: 'tiling',
    tree: [
      'V:2,3',
      tilingLeafToken(FEEDBACK),
      'H',
      tilingLeafToken(TASKS),
      tilingLeafToken(TABLE),
    ],
    instances: [
      {
        instanceId: FEEDBACK,
        vesselId: VesselId('source-feedback'),
        variant: VariantName('snapshot'),
      },
      {
        instanceId: TASKS,
        vesselId: VesselId('project-tasks'),
        variant: VariantName('board'),
      },
      {
        instanceId: TABLE,
        vesselId: VesselId('flexible-table'),
        variant: VariantName('table'),
      },
    ],
  };
}

async function askTyped(intent: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Ask Tasklane'), {
    target: { value: intent },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

function resetStores(): void {
  __resetBoardFilterStoreForTests();
  __resetFeedbackStoreForTests();
  __resetFlexibleTableStoreForTests();
  __resetProjectTasksStoreForTests();
  __resetTaskDetailStoreForTests();
  __resetClickReceiptsForTests();
}
