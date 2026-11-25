// @vitest-environment happy-dom

import type { ConnectorEvent } from '@maelstrom-co/client';
import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  VariantName,
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
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';
import type { LiveCaptureOptions } from './live-capture';
import { OUTLINE_STORAGE_KEY, type Topic } from './outline.store';

vi.mock('@maelstrom-co/realtime', async (original) => ({
  ...(await original<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));
vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class {
    activateAudio() {}
  },
}));
vi.mock('../lib/hosted-vad', () => ({
  HOSTED_VAD_MODEL: 'legacy',
  preloadHostedVadAssets: async () => {},
}));
const liveCapture = vi.hoisted(() => ({
  callbacks: undefined as LiveCaptureOptions | undefined,
  ready: undefined as (() => void) | undefined,
  begin: vi.fn(),
  stop: vi.fn(),
  dispose: vi.fn(),
  commit: vi.fn(() => ({ status: 'sent', eventId: 'commit' })),
}));
vi.mock('./live-capture', () => ({
  createLiveCapture: (options: LiveCaptureOptions) => {
    liveCapture.callbacks = options;
    return {
      start: () =>
        new Promise((resolve) => {
          liveCapture.ready = () =>
            resolve({ inputOnly: true, turnMode: 'server_vad' });
        }),
      beginCapture: liveCapture.begin,
      stopCapture: liveCapture.stop,
      dispose: liveCapture.dispose,
      commitFinalAudio: liveCapture.commit,
    };
  },
}));
const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  sessions: [] as string[],
  release: undefined as (() => void) | undefined,
  delayConnection: false,
  connections: [] as {
    emit: (event: ConnectorEvent) => void;
    ready: () => void;
    reject: () => void;
    connect: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('../lib/connector', () => ({
  createDemoConnector: ({ sessionId }: { sessionId: string }) => {
    engine.sessions.push(sessionId);
    const subscribers = new Set<(event: ConnectorEvent) => void>();
    const base = createMockConnector();
    const connection = {
      emit: (event: ConnectorEvent) => {
        for (const listener of [...subscribers]) listener(event);
      },
      ready: () => {},
      reject: () => {},
      connect: vi.fn(async () => {
        if (engine.delayConnection)
          await new Promise<void>((resolve, reject) => {
            connection.ready = resolve;
            connection.reject = () =>
              reject(new Error('private startup error'));
          });
        await base.connect(sessionId as never);
      }),
    };
    engine.connections.push(connection);
    return {
      ...base,
      connect: connection.connect,
      subscribe: (listener: (event: ConnectorEvent) => void) => {
        subscribers.add(listener);
        return () => {
          subscribers.delete(listener);
        };
      },
      disconnect: async () =>
        connection.emit({
          type: 'disconnected',
          clean: true,
          message: 'test disconnect',
        }),
      process: async (
        message: ChartRequestMessage,
      ): Promise<MaelstromResponse> => {
        engine.requests.push(message);
        const reason = message.request.context.updateReasons.find(
          (reason) => reason.type === 'user_intent',
        );
        const intent = reason?.type === 'user_intent' ? reason.intent : '';
        if (intent === 'Unconfirmed preparation')
          throw new Error('Connection lost after submission');
        const topics = publishedTopics(message);
        const steps: [string, Record<string, unknown>][] = [];
        if (intent === 'Add opening and closing') {
          await new Promise<void>((resolve) => {
            engine.release = resolve;
          });
          steps.push(
            ['createTopic', { content: 'Opening' }],
            ['createTopic', { content: 'Closing' }],
          );
        }
        if (intent === 'Put the closing first and expand it') {
          const closing = topics.find((topic) => topic.content === 'Closing')!;
          steps.push(
            [
              'editTopic',
              { topic: closing.id, content: 'Closing with a question' },
            ],
            ['moveTopic', { topic: closing.id, position: 1 }],
          );
        }
        if (intent === 'Remove opening')
          steps.push([
            'removeTopic',
            { topic: topics.find((topic) => topic.content === 'Opening')!.id },
          ]);
        return {
          type: 'maelstrom_response',
          requestId: message.id,
          userMessage: 'Prepared.',
          rationale: '',
          layout: message.request.layout,
          executionPlan: steps.map(([action, params]) => ({
            instanceId: InstanceId('outline-main'),
            action: ActionName(action),
            params,
          })),
        };
      },
    };
  },
}));

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
  selectVoiceProvider('realtime');
  setPlaygroundKey('sk-outline-test-12345678901234567890');
  localStorage.clear();
  engine.requests = [];
  engine.sessions = [];
  engine.release = undefined;
  engine.delayConnection = false;
  engine.connections = [];
  FakeRealtimeSession.instances = [];
  liveCapture.callbacks = undefined;
  liveCapture.ready = undefined;
  liveCapture.begin.mockClear();
  liveCapture.stop.mockClear();
  liveCapture.dispose.mockClear();
  liveCapture.commit.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  clearPlaygroundKey();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('queues text and actual voice-bridge preparation, projects stable Topic Vessels, and restores only the ordered outline', async () => {
  const { TalkingPointsPage } = await import('./talking-points-page');
  const mounted = render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  await ask('Add opening and closing');
  await waitFor(() => expect(engine.release).toBeTypeOf('function'));
  const session = FakeRealtimeSession.instances.at(-1)!;
  const { instance } = session.options as { instance: RealtimeInstance };
  const voiceScope = instance.createIntentScope!();
  const voice = voiceScope.enqueueIntent('Put the closing first and expand it');
  expect(voice.accepted).toBe(true);
  expect(engine.requests).toHaveLength(1);
  await act(async () => {
    engine.release!();
    await voice.result;
  });
  expect((await voice.result).status).toBe('applied');
  await screen.findByRole('article', { name: 'Closing with a question' });
  expect(visibleTopics()).toEqual(['Closing with a question', 'Opening']);
  const created = publishedTopics(engine.requests[1]!);
  expect(created.map((topic) => topic.content)).toEqual(['Opening', 'Closing']);
  const closingId = created[1]!.id;
  const durable = JSON.parse(localStorage.getItem(OUTLINE_STORAGE_KEY)!);
  expect(durable).toEqual({
    version: 1,
    topics: [{ id: closingId, content: 'Closing with a question' }, created[0]],
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Mark spoken' })[0]!);
  await waitFor(() =>
    expect(
      screen
        .getByRole('article', { name: 'Closing with a question' })
        .getAttribute('data-spoken'),
    ).toBe('true'),
  );
  expect(JSON.parse(localStorage.getItem(OUTLINE_STORAGE_KEY)!)).toEqual(
    durable,
  );
  await ask('Remove opening');
  await waitFor(() =>
    expect(visibleTopics()).toEqual(['Closing with a question']),
  );
  const latest = engine.requests.at(-1)!;
  expect(publishedTopics(latest).map((topic) => topic.id)).toEqual([
    closingId,
    created[0]!.id,
  ]);
  const topicVessel = latest.request.vessels.find(
    (vessel) => vessel.id === `topic-${closingId}`,
  )!;
  expect(topicVessel.description).toContain('Closing with a question');
  expect(Object.keys(topicVessel.variants)).toEqual(['topic']);
  expect(
    topicVessel.variants[VariantName('topic')]!.actions.map(
      (action) => action.name,
    ),
  ).toEqual(['mark', 'unmark']);
  expect(FakeRealtimeSession.instances).toHaveLength(1);
  expect(engine.sessions).toEqual([
    (session.options as { sessionId: string }).sessionId,
  ]);
  expect(
    engine.requests.every(
      (request) => request.sessionId === engine.sessions[0],
    ),
  ).toBe(true);
  mounted.unmount();
  render(<TalkingPointsPage />);
  const restored = await screen.findByRole('article', {
    name: 'Closing with a question',
  });
  expect(restored.getAttribute('data-topic-id')).toBe(closingId);
  expect(restored.getAttribute('data-spoken')).toBe('false');
  expect(visibleTopics()).toEqual(['Closing with a question']);
  voiceScope.retire();
});

it('replaces owner, Provider and connector together without replaying old active work', async () => {
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  const oldSession = FakeRealtimeSession.instances.at(-1)!;
  const { instance } = oldSession.options as { instance: RealtimeInstance };
  const scope = instance.createIntentScope!();
  const active = scope.enqueueIntent('Add opening and closing');
  await waitFor(() => expect(engine.release).toBeTypeOf('function'));
  await act(async () => {
    setPlaygroundKey('sk-replacement-test-12345678901234567890');
  });
  await waitFor(() => expect(FakeRealtimeSession.instances).toHaveLength(2));
  const replacement = FakeRealtimeSession.instances[1]!;
  expect(engine.sessions).toEqual(
    [oldSession, replacement].map(
      (session) => (session.options as { sessionId: string }).sessionId,
    ),
  );
  expect(engine.sessions[1]).not.toBe(engine.sessions[0]);
  await act(async () => {
    engine.release!();
    await active.result;
  });
  expect((await active.result).status).toBe('unknown');
  expect(visibleTopics()).toEqual([]);
  expect(localStorage.getItem(OUTLINE_STORAGE_KEY)).toBeNull();
  expect(engine.requests).toHaveLength(1);
  expect(scope.enqueueIntent('Remove opening').accepted).toBe(false);
});

function publishedTopics(message: ChartRequestMessage): Topic[] {
  const description = message.request.vessels.find(
    (vessel) => vessel.id === 'outline',
  )!.description;
  return JSON.parse(description.split('Ordered Topics:\n')[1]!) as Topic[];
}
function visibleTopics() {
  return screen
    .queryAllByRole('article')
    .map((topic) => topic.getAttribute('aria-label'));
}
async function ask(intent: string) {
  fireEvent.change(screen.getByLabelText('Prepare your outline'), {
    target: { value: intent },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

it('seals actual voice and typed prep, freezes only after accepted batches settle, and resets a pending capture without resurrection', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Existing' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  await ask('Add opening and closing');
  await waitFor(() => expect(engine.release).toBeTypeOf('function'));
  const session = FakeRealtimeSession.instances.at(-1)!;
  const { instance } = session.options as { instance: RealtimeInstance };
  const scope = instance.createIntentScope!();
  const voice = scope.enqueueIntent('Put the closing first and expand it');
  expect(voice.accepted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  expect(scope.enqueueIntent('Remove opening').accepted).toBe(false);
  expect(liveCapture.ready).toBeUndefined();
  await act(async () => {
    engine.release!();
    await voice.result;
  });
  await screen.findByRole('status', { name: 'Take status' });
  expect(screen.queryByLabelText('Prepare your outline')).toBeNull();
  expect(screen.queryByLabelText('Voice status')).toBeNull();
  expect(screen.getByLabelText('Elapsed time').textContent).toBe('00:00');
  expect(liveCapture.begin).not.toHaveBeenCalled();
  expect(visibleTopics()).toEqual([
    'Closing with a question',
    'Existing',
    'Opening',
  ]);
  expect(engine.sessions).toHaveLength(2);
  expect(engine.sessions[0]).not.toBe(engine.sessions[1]);
  const durable = localStorage.getItem(OUTLINE_STORAGE_KEY);
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await act(async () => {
    liveCapture.ready!();
  });
  await screen.findByRole('button', { name: 'Start take' });
  expect(liveCapture.begin).not.toHaveBeenCalled();
  expect(liveCapture.dispose).toHaveBeenCalled();
  expect(screen.queryByLabelText('Take status')).toBeNull();
  expect(localStorage.getItem(OUTLINE_STORAGE_KEY)).toBe(durable);
  expect(engine.sessions).toHaveLength(3);
});

it('shows only silent take controls and frozen Topics, keeps manual marks through fixed finalization, then resets', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Opening' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  await waitFor(() => expect(liveCapture.ready).toBeTypeOf('function'));
  await act(async () => {
    liveCapture.ready!();
  });
  expect(screen.getByLabelText('Take status').textContent).toBe('Listening');
  expect(screen.queryByText('AI-generated voice')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mark spoken' }));
  expect(
    screen
      .getByRole('article', { name: 'Opening' })
      .getAttribute('data-spoken'),
  ).toBe('true');
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  expect(liveCapture.stop).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(2999));
  expect(screen.getByLabelText('Take status').textContent).toBe('Finalizing…');
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByLabelText('Take status').textContent).toMatch(/Stopped/);
  expect(screen.getByText(/tail may be incomplete/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start take' })).toBeNull();
  expect(
    screen
      .getByRole('article', { name: 'Opening' })
      .getAttribute('data-spoken'),
  ).toBe('true');
  vi.useRealTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await screen.findByRole('button', { name: 'Start take' });
  expect(
    screen
      .getByRole('article', { name: 'Opening' })
      .getAttribute('data-spoken'),
  ).toBe('false');
  expect(screen.queryByLabelText('Elapsed time')).toBeNull();
});

it('fails Start visibly after an unknown preparation outcome without freezing or replay', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Opening' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  await ask('Unconfirmed preparation');
  await screen.findByText(/Outcome not confirmed/);
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toMatch(
    /did not settle successfully/,
  );
  expect(liveCapture.ready).toBeUndefined();
  expect(engine.requests).toHaveLength(1);
  expect(engine.sessions).toHaveLength(2);
  expect(visibleTopics()).toEqual(['Opening']);
});

it('Reset during the preparation barrier retires authority before old active Actions return', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Existing' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  await ask('Add opening and closing');
  await waitFor(() => expect(engine.release).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(engine.sessions).toHaveLength(2));
  const durable = localStorage.getItem(OUTLINE_STORAGE_KEY);
  await act(async () => {
    engine.release!();
  });
  expect(visibleTopics()).toEqual(['Existing']);
  expect(localStorage.getItem(OUTLINE_STORAGE_KEY)).toBe(durable);
  expect(liveCapture.ready).toBeUndefined();
});

it('waits for the real live Engine connection, then stops an idle take immediately on Engine loss without reconnecting or losing marks/time', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Opening' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  engine.delayConnection = true;
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  await waitFor(() => expect(engine.connections).toHaveLength(2));
  await waitFor(() =>
    expect(engine.connections[1]!.connect).toHaveBeenCalledTimes(1),
  );
  expect(liveCapture.ready).toBeUndefined();
  expect(screen.getByLabelText('Take status').textContent).toBe('Starting…');
  expect(screen.getByLabelText('Elapsed time').textContent).toBe('00:00');
  expect(
    screen.getByLabelText('Engine connection status').textContent,
  ).toContain('connecting');
  await act(async () => {
    engine.connections[1]!.ready();
  });
  await waitFor(() => expect(liveCapture.ready).toBeTypeOf('function'));
  vi.useFakeTimers();
  await act(async () => {
    liveCapture.ready!();
  });
  expect(screen.getByLabelText('Take status').textContent).toBe('Listening');
  fireEvent.click(screen.getByRole('button', { name: 'Mark spoken' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(engine.requests).toHaveLength(0);
  const elapsed = screen.getByLabelText('Elapsed time').textContent;
  act(() =>
    engine.connections[1]!.emit({
      type: 'disconnected',
      clean: false,
      message: 'private transport detail',
    }),
  );
  expect(liveCapture.stop).toHaveBeenCalledTimes(1);
  expect(liveCapture.dispose).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Take status').textContent).toContain('Stopped');
  expect(screen.getByRole('alert').textContent).toMatch(
    /Engine connection.*retained/i,
  );
  expect(screen.getByRole('alert').textContent).not.toContain(
    'private transport detail',
  );
  expect(
    screen.getByLabelText('Engine connection status').textContent,
  ).toContain('disconnected');
  expect(
    screen
      .getByRole('article', { name: 'Opening' })
      .getAttribute('data-spoken'),
  ).toBe('true');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(screen.getByLabelText('Elapsed time').textContent).toBe(elapsed);
  expect(engine.connections[1]!.connect).toHaveBeenCalledTimes(1);
  expect(liveCapture.begin).toHaveBeenCalledTimes(1);
  expect(engine.requests).toHaveLength(0);
});

it('stops a failed Engine startup before microphone setup and cannot revive it on readiness', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Opening' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  engine.delayConnection = true;
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  await waitFor(() =>
    expect(engine.connections[1]?.connect).toHaveBeenCalledTimes(1),
  );
  await act(async () => {
    engine.connections[1]!.reject();
  });
  expect(screen.getByRole('alert').textContent).toMatch(
    /Engine connection.*retained/i,
  );
  expect(screen.getByLabelText('Take status').textContent).toContain('Stopped');
  expect(screen.getByLabelText('Elapsed time').textContent).toBe('00:00');
  expect(liveCapture.ready).toBeUndefined();
  await act(async () => {
    engine.connections[1]!.ready();
  });
  expect(liveCapture.begin).not.toHaveBeenCalled();
  expect(engine.connections[1]!.connect).toHaveBeenCalledTimes(1);
});

it('stops capture setup on Engine errors and isolates late Engine/capture events after Reset from the replacement take', async () => {
  localStorage.setItem(
    OUTLINE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      topics: [
        { id: 'tp-00000000-0000-4000-8000-000000000001', content: 'Opening' },
      ],
    }),
  );
  const { TalkingPointsPage } = await import('./talking-points-page');
  render(<TalkingPointsPage />);
  await screen.findByRole('status', { name: 'Connection status: connected' });
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  await waitFor(() => expect(liveCapture.ready).toBeTypeOf('function'));
  const oldEngine = engine.connections[1]!;
  const oldReady = liveCapture.ready!;
  const oldCapture = liveCapture.callbacks!;
  act(() =>
    oldEngine.emit({
      type: 'error',
      error: new Error('private connection error'),
    }),
  );
  expect(screen.getByLabelText('Take status').textContent).toContain('Stopped');
  expect(liveCapture.stop).toHaveBeenCalledTimes(1);
  expect(liveCapture.begin).not.toHaveBeenCalled();
  await act(async () => {
    oldReady();
  });
  expect(liveCapture.begin).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  await screen.findByRole('button', { name: 'Start take' });
  liveCapture.ready = undefined;
  fireEvent.click(screen.getByRole('button', { name: 'Start take' }));
  await waitFor(() => expect(liveCapture.ready).toBeTypeOf('function'));
  await act(async () => {
    liveCapture.ready!();
  });
  expect(screen.getByLabelText('Take status').textContent).toBe('Listening');
  const stops = liveCapture.stop.mock.calls.length;
  act(() => {
    oldEngine.emit({
      type: 'disconnected',
      clean: false,
      message: 'old socket',
    });
    oldEngine.emit({ type: 'error', error: new Error('old error') });
    oldCapture.onFatalError(new Error('old capture') as never);
    oldCapture.onCompleted({
      itemId: 'old',
      previousItemId: null,
      contentIndex: 0,
      transcript: 'old speech',
    });
  });
  expect(screen.getByLabelText('Take status').textContent).toBe('Listening');
  expect(
    screen.getByLabelText('Engine connection status').textContent,
  ).toContain('connected');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(liveCapture.stop).toHaveBeenCalledTimes(stops);
  expect(liveCapture.begin).toHaveBeenCalledTimes(1);
  expect(engine.requests).toHaveLength(0);
});
