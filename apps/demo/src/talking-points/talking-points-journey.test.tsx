// @vitest-environment happy-dom

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
const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  sessions: [] as string[],
  release: undefined as (() => void) | undefined,
}));
vi.mock('../lib/connector', () => ({
  createDemoConnector: ({ sessionId }: { sessionId: string }) => {
    engine.sessions.push(sessionId);
    return {
      ...createMockConnector(),
      process: async (
        message: ChartRequestMessage,
      ): Promise<MaelstromResponse> => {
        engine.requests.push(message);
        const reason = message.request.context.updateReasons.find(
          (reason) => reason.type === 'user_intent',
        );
        const intent = reason?.type === 'user_intent' ? reason.intent : '';
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
  FakeRealtimeSession.instances = [];
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
