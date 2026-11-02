// @vitest-environment happy-dom

import {
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
} from '@maelstrom-co/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { m } from '../lib/maelstrom';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';
import { shopM } from '../shop/maelstrom';
import { tasklaneM } from '../tasklane/maelstrom';
import {
  __resetFeedbackStoreForTests,
  getFeedbackSnapshot,
} from '../tasklane/stores/feedback.store';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
} from '../tasklane/stores/project-tasks.store';

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
}));

vi.mock('../lib/connector', () => ({
  createDemoConnector: () => ({
    ...createMockConnector(),
    process: async (message: ChartRequestMessage) => {
      engine.requests.push(message);
      return keepLayout(message);
    },
  }),
}));

const TASKLANE_VESSEL_IDS = ['project-tasks', 'source-feedback'];
const FEEDBACK = InstanceId('source-feedback-main');
const TASKS = InstanceId('project-tasks-main');

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
  clearPlaygroundKey();
  resetTasklaneStores();
  vi.stubGlobal('ResizeObserver', LayoutHostResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearPlaygroundKey();
  resetTasklaneStores();
});

describe('Tasklane Vessel catalog', () => {
  it('registers only the Feedback and Tasks Vessels on its own instance', () => {
    expect(tasklaneM.vessels.map((entry) => entry.vessel.id).sort()).toEqual(
      TASKLANE_VESSEL_IDS,
    );
  });

  it('keeps the Tasklane Vessels out of the home and shop instances', () => {
    const others = [...m.vessels, ...shopM.vessels].map(
      (entry) => entry.vessel.id,
    );
    for (const id of TASKLANE_VESSEL_IDS) expect(others).not.toContain(id);
  });
});

describe('/tasks without a key', () => {
  it('explains Tasklane and the host-app relationship before the key step', async () => {
    const { TasklanePage } = await import('../tasklane/tasklane-page');
    render(<TasklanePage />);

    expect(screen.getByRole('heading', { name: 'Tasklane' })).toBeTruthy();
    expect(screen.getByText('Powered by Maelstrom')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Back to the main demo' })
        .getAttribute('href'),
    ).toBe('/');

    const intro = screen.getByRole('region', { name: 'About Tasklane' });
    expect(intro.textContent).toContain(
      'Tasklane is a sample task app with Maelstrom built in.',
    );
    expect(intro.textContent).toContain(
      'Tasklane, the host app, supplies the Vessels (its views) and the Actions they offer.',
    );
    expect(intro.textContent).toContain(
      'not a live ClickUp, Jira or Todoist integration',
    );
    expect(intro.textContent).toContain('Works today:');
    expect(intro.textContent).toContain('In development:');
    expect(screen.getByRole('status', { name: /key required/i })).toBeTruthy();

    const preview = screen.getByRole('region', {
      name: 'Example Tasklane project',
    });
    expect(within(preview).getByText('Update demo README')).toBeTruthy();
    expect(within(preview).getByText(/real layout tool/)).toBeTruthy();
    expect(engine.requests).toHaveLength(0);
  });

  it('opens the key drawer instead of sending a typed request', async () => {
    const { TasklanePage } = await import('../tasklane/tasklane-page');
    render(<TasklanePage />);

    fireEvent.change(screen.getByLabelText('Ask Tasklane'), {
      target: { value: 'Turn this feedback into tasks.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add key' }));

    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(engine.requests).toHaveLength(0);
  });
});

describe('/tasks with a key', () => {
  it('starts on Feedback beside Tasks with the seeded records', async () => {
    setPlaygroundKey('sk-tasklane-start-1234567890');
    const { TasklanePage } = await import('../tasklane/tasklane-page');
    render(<TasklanePage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    await waitFor(() => {
      expect(instance(FEEDBACK)?.textContent).toContain('real layout tool');
      expect(instance(TASKS)?.textContent).toContain('Update demo README');
    });
    expect(screen.getByRole('heading', { name: 'Tasklane' })).toBeTruthy();
    expect(
      document.querySelector('#tasklane-intent')?.getAttribute('placeholder'),
    ).toBe('What would you like to do with these tasks?');
  });

  it('keeps the dock outside the Chart host', async () => {
    setPlaygroundKey('sk-tasklane-dock-1234567890');
    const { TasklanePage } = await import('../tasklane/tasklane-page');
    const { container } = render(<TasklanePage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    const chartHost = must(container.querySelector('.chart-wrapper'));
    expect(
      chartHost.contains(must(container.querySelector('.tasklane-dock'))),
    ).toBe(false);
  });

  it('sends a typed request with only the Tasklane Vessels in the catalog', async () => {
    setPlaygroundKey('sk-tasklane-typed-1234567890');
    const { TasklanePage } = await import('../tasklane/tasklane-page');
    render(<TasklanePage />);

    await screen.findByRole('status', {
      name: 'Connection status: connected',
    });
    fireEvent.change(screen.getByLabelText('Ask Tasklane'), {
      target: { value: 'Turn this feedback into tasks.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() =>
      expect(intentRequest('Turn this feedback into tasks.')).toBeDefined(),
    );
    expect(
      must(intentRequest('Turn this feedback into tasks.'))
        .request.vessels.map((vessel) => vessel.id)
        .sort(),
    ).toEqual(TASKLANE_VESSEL_IDS);
  });

  it('edits a task and the feedback by hand on the live page', async () => {
    setPlaygroundKey('sk-tasklane-by-hand-1234567890');
    const { TasklanePage } = await import('../tasklane/tasklane-page');
    render(<TasklanePage />);

    const assignee = await screen.findByRole(
      'combobox',
      { name: 'Assignee for Record launch video' },
      { timeout: 2000 },
    );
    await act(async () => {
      fireEvent.change(assignee, { target: { value: 'chris' } });
    });
    await waitFor(() =>
      expect(getProjectTasksSnapshot().tasks[1]?.assigneeId).toBe('chris'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Feedback text' }), {
      target: { value: 'Shorter feedback' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }));
    });
    await waitFor(() =>
      expect(getFeedbackSnapshot().text).toBe('Shorter feedback'),
    );
  });
});

function keepLayout(message: ChartRequestMessage): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: message.id,
    userMessage: '',
    rationale: '',
    executionPlan: [],
    layout: message.request.layout,
  };
}

function intentRequest(intent: string): ChartRequestMessage | undefined {
  return engine.requests.find((message) =>
    message.request.context.updateReasons.some(
      (reason) => reason.type === 'user_intent' && reason.intent === intent,
    ),
  );
}

function instance(instanceId: InstanceId): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-instance-id="${instanceId}"]`,
  );
}

function resetTasklaneStores(): void {
  __resetFeedbackStoreForTests();
  __resetProjectTasksStoreForTests();
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}
