// @vitest-environment happy-dom

import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  ToolCallId,
} from '@maelstrom-co/protocol';
import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeSession,
  ToolResult,
} from '@maelstrom-co/realtime';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createMockConnector } from '../lib/__tests__/mock-connector';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import { selectVoiceProvider } from '../lib/voice-provider';

const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  sessions: [] as string[],
  release: undefined as (() => void) | undefined,
}));
const voice = vi.hoisted(() => ({
  sessions: [] as RealtimeSession[],
  adapters: [] as TestAdapter[],
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
        const contents =
          intent === 'Add opening and closing'
            ? ['Opening', 'Closing']
            : [intent];
        if (intent === 'Add opening and closing')
          await new Promise<void>((resolve) => {
            engine.release = resolve;
          });
        return {
          type: 'maelstrom_response',
          requestId: message.id,
          userMessage: `${intent} applied`,
          rationale: '',
          layout: message.request.layout,
          executionPlan: contents.map((content) => ({
            instanceId: InstanceId('outline-main'),
            action: ActionName('createTopic'),
            params: { content },
          })),
        };
      },
    };
  },
}));
vi.mock('../lib/voice-adapter', () => ({
  prepareBrowserOpenAIVoice: () => false,
  createAdapter: () => {
    const adapter = new TestAdapter();
    voice.adapters.push(adapter);
    return adapter;
  },
}));
vi.mock('../lib/demo-voice', async (original) => {
  const actual = await original<typeof import('../lib/demo-voice')>();
  return {
    ...actual,
    registerDemoVoice: (
      session: RealtimeSession,
      context: Parameters<typeof actual.registerDemoVoice>[1],
    ) => {
      voice.sessions.push(session);
      return actual.registerDemoVoice(session, context);
    },
  };
});

class TestAdapter implements RealtimeProviderAdapter {
  readonly observations = { subscribe: () => () => {} };
  readonly results: { callId: ToolCallId; result: ToolResult }[] = [];
  private readonly handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  async connect() {}
  async disconnect() {}
  getAudioStreams() {
    return {};
  }
  injectGrounding() {}
  async sendToolResult(callId: ToolCallId, result: ToolResult) {
    this.results.push({ callId, result });
  }
  on(handler: (event: RealtimeAdapterEvent) => void) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
  submit(callId: string, intent: string) {
    for (const handler of this.handlers)
      handler({
        type: 'tool_call',
        callId: ToolCallId(callId),
        name: 'submit_intent',
        argumentsJson: JSON.stringify({ intent }),
      });
  }
}

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
  selectVoiceProvider('realtime');
  setPlaygroundKey('sk-provider-switch-test-12345678901234567890');
  localStorage.clear();
  engine.requests = [];
  engine.sessions = [];
  engine.release = undefined;
  voice.sessions = [];
  voice.adapters = [];
  // Geometry is not under test; real sessions and scheduler admission are.
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

it.each(['text', 'voice'] as const)(
  'preserves active %s and pending typed preparation while retiring only pending old-provider voice',
  async (source) => {
    const { TalkingPointsPage } = await import('./talking-points-page');
    render(<TalkingPointsPage />);
    await screen.findByRole('status', { name: 'Connection status: connected' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    });
    const oldSession = voice.sessions[0]!;
    const oldAdapter = voice.adapters[0]!;
    await waitFor(() => expect(oldSession.state).toBe('connected'));
    if (source === 'text') await ask('Add opening and closing');
    else
      await act(async () => {
        oldAdapter.submit('active-voice', 'Add opening and closing');
      });
    await waitFor(() => expect(engine.release).toBeTypeOf('function'));
    await ask('Typed follow-up');
    await act(async () => {
      oldAdapter.submit('pending-voice', 'Retired voice topic');
    });
    expect(oldSession.memory.find(ToolCallId('pending-voice'))?.status).toBe(
      'queued',
    );
    expect(engine.requests).toHaveLength(1);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Voice provider'), {
        target: { value: 'live' },
      });
    });
    await waitFor(() => expect(voice.sessions).toHaveLength(2));
    expect(engine.sessions).toHaveLength(1);
    expect(oldSession.memory.find(ToolCallId('pending-voice'))?.status).toBe(
      'not_submitted',
    );
    if (source === 'voice')
      expect(oldSession.memory.find(ToolCallId('active-voice'))?.status).toBe(
        'submitted',
      );
    expect(voice.sessions[1]!.memory.sessionId).toBe(
      oldSession.memory.sessionId,
    );
    expect(
      screen.getByRole('status', { name: 'Preparation result' }).textContent,
    ).toBe('Queued…');

    await act(async () => {
      engine.release!();
    });
    await screen.findByRole('article', { name: 'Typed follow-up' });
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Preparation result' }).textContent,
      ).toBe('Typed follow-up applied'),
    );
    expect(
      screen
        .getAllByRole('article')
        .map((topic) => topic.getAttribute('aria-label')),
    ).toEqual(['Opening', 'Closing', 'Typed follow-up']);
    expect(engine.requests).toHaveLength(2);
    if (source === 'voice')
      await waitFor(() =>
        expect(oldSession.memory.find(ToolCallId('active-voice'))?.status).toBe(
          'completed',
        ),
      );
    expect(oldAdapter.results).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    });
    await act(async () => {
      voice.adapters[1]!.submit('new-voice', 'New voice topic');
    });
    await screen.findByRole('article', { name: 'New voice topic' });
    await waitFor(() =>
      expect(voice.adapters[1]!.results.map((result) => result.callId)).toEqual(
        [ToolCallId('new-voice')],
      ),
    );
    expect(oldAdapter.results).toEqual([]);
    expect(engine.sessions).toHaveLength(1);
    expect(
      engine.requests.every(
        (request) => request.sessionId === engine.sessions[0],
      ),
    ).toBe(true);
  },
);

async function ask(intent: string) {
  fireEvent.change(screen.getByLabelText('Prepare your outline'), {
    target: { value: intent },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}
