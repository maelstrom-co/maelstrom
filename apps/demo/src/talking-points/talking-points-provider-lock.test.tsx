// @vitest-environment happy-dom

import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  SessionId,
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

import { KeylessVoiceProviderSelect } from '../components/voice-provider-select';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';
import {
  type DemoVoiceProvider,
  selectVoiceProvider,
  voiceProviderStore,
} from '../lib/voice-provider';
import { createOutlineStore } from './outline.store';

const engine = vi.hoisted(() => ({
  requests: [] as ChartRequestMessage[],
  sessions: [] as string[],
  release: undefined as (() => void) | undefined,
}));
const voice = vi.hoisted(() => ({
  sessions: [] as RealtimeSession[],
  adapters: [] as TestAdapter[],
  providers: [] as DemoVoiceProvider[],
  prepare: vi.fn(() => false),
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
vi.mock('@maelstrom-co/realtime-openai', async (original) => ({
  ...(await original<typeof import('@maelstrom-co/realtime-openai')>()),
  OpenAIAdapter: class extends TestAdapter {},
}));
vi.mock('../lib/voice-adapter', async (original) => {
  const actual = await original<typeof import('../lib/voice-adapter')>();
  voice.prepare.mockImplementation(actual.prepareBrowserOpenAIVoice);
  return {
    ...actual,
    prepareBrowserOpenAIVoice: voice.prepare,
    createAdapter: (...args: Parameters<typeof actual.createAdapter>) => {
      voice.providers.push(args[0]);
      const adapter = actual.createAdapter(...args) as TestAdapter;
      voice.adapters.push(adapter);
      return adapter;
    },
  };
});
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
  activateAudioCalls = 0;
  activateAudio() {
    this.activateAudioCalls += 1;
    return Promise.resolve();
  }
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
  voice.providers = [];
  voice.prepare.mockClear();
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
  'preserves active %s and pending typed preparation while retiring only pending disconnected voice',
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
      fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    });
    await waitFor(() => expect(oldSession.state).toBe('idle'));
    expect(engine.sessions).toHaveLength(1);
    expect(oldSession.memory.find(ToolCallId('pending-voice'))?.status).toBe(
      'not_submitted',
    );
    if (source === 'voice')
      expect(oldSession.memory.find(ToolCallId('active-voice'))?.status).toBe(
        'submitted',
      );
    expect(voice.sessions).toHaveLength(1);
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
      oldAdapter.submit('new-voice', 'New voice topic');
    });
    await screen.findByRole('article', { name: 'New voice topic' });
    await waitFor(() =>
      expect(oldAdapter.results.map((result) => result.callId)).toEqual([
        ToolCallId('new-voice'),
      ]),
    );
    expect(oldAdapter.results.map((result) => result.callId)).toEqual([
      ToolCallId('new-voice'),
    ]);
    expect(engine.sessions).toHaveLength(1);
    expect(
      engine.requests.every(
        (request) => request.sessionId === engine.sessions[0],
      ),
    ).toBe(true);
  },
);

it.each(['live', 'livekit', 'realtime'] as const)(
  'locks preparation across key save and remount without changing inherited %s',
  async (inherited) => {
    clearPlaygroundKey();
    voiceProviderStore.setState(() => ({ provider: inherited }));
    const { TalkingPointsPage } = await import('./talking-points-page');
    const page = render(<TalkingPointsPage />);
    await screen.findByRole('button', { name: 'Add an API key to prepare' });
    expect(screen.queryByLabelText('Voice provider')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Add an API key to prepare' }),
    );
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'sk-lock-test-12345678901234567890' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status', { name: 'Connection status: connected' });
    expect(screen.queryByLabelText('Voice provider')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    });
    expect(voice.providers).toEqual(['realtime']);
    expect(voice.adapters[0]?.activateAudioCalls).toBeGreaterThanOrEqual(1);
    expect(voice.prepare).toHaveBeenCalledExactlyOnceWith('realtime');
    expect(voiceProviderStore.state.provider).toBe(inherited);
    page.unmount();
    render(<TalkingPointsPage />);
    await screen.findByRole('status', { name: 'Connection status: connected' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    });
    expect(voice.providers).toEqual(['realtime', 'realtime']);
    expect(screen.queryByLabelText('Voice provider')).toBeNull();
    expect(voiceProviderStore.state.provider).toBe(inherited);
    cleanup();
    vi.stubEnv('VITE_HOSTED', '0');
    render(
      <KeylessVoiceProviderSelect options={['live', 'realtime', 'livekit']} />,
    );
    expect(screen.getByLabelText('Voice provider')).toHaveProperty(
      'value',
      inherited,
    );
    fireEvent.change(screen.getByLabelText('Voice provider'), {
      target: { value: inherited === 'live' ? 'livekit' : 'live' },
    });
    expect(voiceProviderStore.state.provider).toBe(
      inherited === 'live' ? 'livekit' : 'live',
    );
  },
);

it('rejects an unsupported provider at the runtime boundary', async () => {
  const { createPreparationRuntime, PREPARATION_LAYOUT } =
    await import('./maelstrom');
  const runtime = createPreparationRuntime(createOutlineStore());
  const m = runtime.m;
  let changeProvider!: ReturnType<typeof m.useVoice>['switchProvider'];
  function Probe() {
    changeProvider = m.useVoice().switchProvider;
    return null;
  }
  const view = render(
    <m.Provider
      sessionId={SessionId('locked-runtime')}
      connector={createMockConnector()}
      initialLayout={PREPARATION_LAYOUT}
    >
      <Probe />
    </m.Provider>,
  );
  try {
    // Exercise untyped callers as well as the singleton TypeScript contract.
    await expect(changeProvider('live' as 'realtime')).rejects.toThrow(
      'Unknown voice provider: live',
    );
    expect(voice.providers).toEqual(['realtime']);
  } finally {
    view.unmount();
    runtime.owner.retire();
    runtime.admission.retire();
    runtime.m.disposeDevtools();
  }
});

async function ask(intent: string) {
  fireEvent.change(screen.getByLabelText('Prepare your outline'), {
    target: { value: intent },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}
