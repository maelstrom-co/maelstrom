// @vitest-environment happy-dom

import type { EngineConnector, Orchestrator } from '@maelstrom-co/client';
import { createTestConnector } from '@maelstrom-co/client/_testing';
import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  type AgentUtteranceInput,
  type MessageId,
  RunId,
  type TilingLayout,
} from '@maelstrom-co/protocol';
import { createMaelstrom } from '@maelstrom-co/react';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';

interface VoiceResultStub {
  state: string;
  error: unknown;
  connect: () => Promise<void>;
  provider: string;
  switching: boolean;
  switchProvider: (provider: string) => Promise<void>;
}

let voiceResult: VoiceResultStub;
let connector: EngineConnector;
let orchestrator: Orchestrator | undefined;
let chartHostWidth = 1024;
const seededLayouts: Array<TilingLayout | undefined> = [];
const m = createMaelstrom({ vessels: [], intentRoute: 'agent' }).with(
  (context) => ({
    useContext: context.useMaelstromContext,
  }),
);
type ProviderProps = ComponentProps<typeof m.Provider>;

vi.doMock('./maelstrom', () => ({
  shopM: {
    ...m,
    // The shop Vessels are not registered here, so the seeded first screen
    // is recorded instead of booted.
    Provider: ({
      initialLayout,
      ...props
    }: ProviderProps & { initialLayout?: TilingLayout }) => {
      seededLayouts.push(initialLayout);
      return <m.Provider {...(props as ProviderProps)} />;
    },
    useVoice: () => voiceResult,
    Chart: () => null,
    Devtools: () => <div data-testid="shop-devtools" />,
  },
}));
vi.doMock('../lib/connector', () => ({
  createDemoConnector: () => connector,
}));
vi.doMock('../lib/hosted-vad', () => ({
  preloadHostedVadAssets: async () => {},
}));
vi.doMock('../lib/diagnostic-capture', () => ({
  diagnosticCapture: { stop: () => {} },
}));
vi.doMock('../lib/voice-adapter', () => ({
  prepareBrowserOpenAIVoice: () => false,
}));
vi.doMock('./shop-option-sync', () => ({
  ShopOptionSync: () => {
    orchestrator = m.useContext().orchestrator;
    return null;
  },
}));
vi.doMock('./shop-voice-corner', () => ({
  ShopVoiceCorner: ({ reply }: { reply?: ReactNode }) => <>{reply}</>,
}));
vi.doMock('./shop-keyless-preview', () => ({
  ShopKeylessPreview: ({
    intent,
    onIntentChange,
    onBlockedSubmit,
  }: {
    intent: string;
    onIntentChange: (intent: string) => void;
    onBlockedSubmit: () => void;
  }) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onBlockedSubmit();
      }}
    >
      <input
        aria-label="Ask the pet shop"
        value={intent}
        onChange={(event) => onIntentChange(event.target.value)}
      />
      <button type="submit">Send</button>
    </form>
  ),
}));
vi.doMock('../components/key-drawer', () => ({
  KeyDrawer: ({
    isOpen,
    errorMessage,
    onSave,
  }: {
    isOpen: boolean;
    errorMessage?: string | null;
    onSave: (apiKey: string) => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="API key">
        <p data-testid="key-error">{errorMessage}</p>
        <button
          type="button"
          onClick={() => onSave('test-only-replacement-key')}
        >
          Save key
        </button>
      </div>
    ) : null,
}));
const { ShopPage } = await import('./shop-page');

const UI_ROUTE_PROVIDER_FAILURE = {
  error: 'The UI request failed.',
  code: 'ProviderError',
} as const;
const AGENT_ROUTE_PROVIDER_FAILURE = {
  error: 'The model could not respond.',
  code: 'provider_error',
} as const;
const MODEL_FAILURE_COPY =
  'The model request failed. Check your API key and try again.';
const NO_METRICS = {
  turns: 0,
  toolCalls: { requested: 0, admitted: 0 },
  elapsedMs: 0,
  inputTokens: 0,
  outputTokens: 0,
};

class MeasuredResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: chartHostWidth } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  vi.stubEnv('VITE_VOICE_PROVIDER', '');
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  chartHostWidth = 1024;
  seededLayouts.length = 0;
  orchestrator = undefined;
  voiceResult = {
    state: 'idle',
    error: undefined,
    connect: async () => {},
    provider: 'live',
    switching: false,
    switchProvider: async () => {},
  };
});

afterEach(() => {
  cleanup();
  clearPlaygroundKey();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ShopPage typed intents', () => {
  it('sends the trimmed draft through sendMessage as text input and clears the draft', async () => {
    const h = await renderShop();
    const client = mountedOrchestrator();
    const sendMessage = vi.spyOn(client, 'sendMessage');
    const enqueueIntent = vi.spyOn(client, 'enqueueIntent');

    h.type('  show my orders  ');
    await h.send();

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith('show my orders', {
      source: 'text',
    });
    expect(h.engine.utterances()).toEqual([
      { text: 'show my orders', source: 'text' },
    ]);
    expect(h.input().value).toBe('');
    expect(enqueueIntent).not.toHaveBeenCalled();
  });

  it('restores the draft when the send is rejected', async () => {
    const h = await renderShop();
    h.engine.rejectNextInput(new Error('socket closed'));

    h.type('restore me');
    await h.send();

    expect(h.input().value).toBe('restore me');
    expect(h.view.queryByRole('dialog')).toBeNull();
  });

  it('shows the Agent Run reply and thinks while the run is open', async () => {
    const h = await renderShop();
    h.type('show my orders');
    await h.send();
    const [inputId] = h.engine.inputIds();
    const runId = RunId('run-reply');

    expect(h.thinking()).toBe(true);

    await h.engine.emit(accepted(inputId, runId), {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId,
      turnId: 'turn-1',
      delta: 'Here are your orders.',
    });
    expect(h.thinking()).toBe(true);
    expect(h.view.getByTestId('shop-agent-reply').textContent).toBe(
      'Here are your orders.',
    );

    await h.engine.emit({
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId,
      ok: true,
      reason: 'completed',
      reply: 'Here are your orders.',
      metrics: NO_METRICS,
    });
    expect(h.thinking()).toBe(false);
  });

  it.each([
    ['UI-only route', UI_ROUTE_PROVIDER_FAILURE],
    ['agent route', AGENT_ROUTE_PROVIDER_FAILURE],
  ])(
    'restores the draft and reopens the key drawer when the run fails with the %s provider code',
    async (_route, failure) => {
      const h = await renderShop();
      h.type('restore me');
      await h.send();
      expect(h.input().value).toBe('');
      const [inputId] = h.engine.inputIds();
      const runId = RunId('run-provider-failure');

      await h.engine.emit(
        accepted(inputId, runId),
        failedFinish(runId, failure),
      );

      expect(h.input().value).toBe('restore me');
      expect(h.view.getByTestId('key-error').textContent).toBe(
        MODEL_FAILURE_COPY,
      );
      expect(h.engine.utterances()).toHaveLength(1);
    },
  );

  it('keeps newer typing when an older run fails with a provider code', async () => {
    const h = await renderShop();
    h.type('old');
    await h.send();
    h.type('newer');
    const [inputId] = h.engine.inputIds();
    const runId = RunId('run-older');

    await h.engine.emit(
      accepted(inputId, runId),
      failedFinish(runId, AGENT_ROUTE_PROVIDER_FAILURE),
    );

    expect(h.input().value).toBe('newer');
    expect(h.view.getByTestId('key-error').textContent).toBe(
      MODEL_FAILURE_COPY,
    );
  });

  it('leaves the draft cleared and the drawer closed for a run failure other than the model provider', async () => {
    const h = await renderShop();
    h.type('timed out');
    await h.send();
    const [inputId] = h.engine.inputIds();
    const runId = RunId('run-timeout');

    await h.engine.emit(
      accepted(inputId, runId),
      failedFinish(runId, {
        error: 'The UI acknowledgement did not arrive.',
        code: 'ui_ack_timeout',
      }),
    );

    expect(h.input().value).toBe('');
    expect(h.view.queryByRole('dialog')).toBeNull();
  });

  it('submits a resumed draft once when the new session connects', async () => {
    const engine = scriptedEngine({ gatedConnect: true });
    connector = engine.connector;
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<ShopPage />);
    });
    fireEvent.change(view.getByRole('textbox', { name: 'Ask the pet shop' }), {
      target: { value: '  resume me ' },
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Send' }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Save key' }));
    });
    const input = () =>
      view.getByRole('combobox', {
        name: 'Ask the pet shop',
      }) as HTMLInputElement;

    expect(engine.utterances()).toEqual([]);
    expect(input().value).toBe('  resume me ');

    await act(async () => {
      engine.openConnection();
    });

    expect(engine.utterances()).toEqual([
      { text: 'resume me', source: 'text' },
    ]);
    expect(input().value).toBe('');
  });
});

describe('ShopPage typed intents on a hosted build', () => {
  it('sends the draft through sendMessage and never enqueues an intent', async () => {
    vi.stubEnv('VITE_HOSTED', '1');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '');
    const h = await renderShop();
    const client = mountedOrchestrator();
    const sendMessage = vi.spyOn(client, 'sendMessage');
    const enqueueIntent = vi.spyOn(client, 'enqueueIntent');

    h.type('show my orders');
    await h.send();

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith('show my orders', {
      source: 'text',
    });
    expect(h.engine.utterances()).toEqual([
      { text: 'show my orders', source: 'text' },
    ]);
    expect(h.input().value).toBe('');
    expect(enqueueIntent).not.toHaveBeenCalled();
    expect(h.engine.chartRequests).toBe(0);
  });
});

describe('ShopPage voice key errors', () => {
  it.each([
    [
      'an HTTP 401 exchange',
      new LiveTransportError('exchange_rejected', { status: 401 }),
    ],
    ['a missing key', new LiveTransportError('missing_key')],
  ])(
    'reopens the key drawer with the Live key message for %s',
    async (_case, cause) => {
      voiceResult = {
        ...voiceResult,
        state: 'error',
        error: new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Live connection failed',
          cause,
        ),
      };

      const h = await renderShop();

      expect(h.view.getByTestId('key-error').textContent).toBe(
        'Live could not use this API key. Update the key, then reconnect.',
      );
    },
  );

  it('leaves the key drawer closed when Live fails for a reason other than the key', async () => {
    voiceResult = {
      ...voiceResult,
      state: 'error',
      error: new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Live connection failed',
        new LiveTransportError('exchange_rejected', { status: 429 }),
      ),
    };

    const h = await renderShop();

    expect(h.view.queryByRole('dialog')).toBeNull();
  });

  it('keeps reopening the key drawer with the mint message when a token mint fails', async () => {
    voiceResult = {
      ...voiceResult,
      state: 'error',
      error: new RealtimeVoiceError(
        'TOKEN_MINT_FAILED',
        'Token mint failed',
        new Error('That key was rejected.'),
      ),
    };

    const h = await renderShop();

    expect(h.view.getByTestId('key-error').textContent).toBe(
      'That key was rejected.',
    );
  });
});

describe('ShopPage chrome', () => {
  it('seeds the stacked shop screen when the chart host is narrow', async () => {
    chartHostWidth = 390;

    await renderShop();

    expect(seededLayouts.at(-1)?.tree[0]).toBe('H');
  });

  it('seeds the side-by-side shop screen when the chart host is wide', async () => {
    chartHostWidth = 1024;

    await renderShop();

    expect(seededLayouts.at(-1)?.tree[0]).toBe('V');
  });

  it('offers only GPT-Live and OpenAI Realtime in the voice picker', async () => {
    const h = await renderShop();

    const picker = h.view.getByRole('combobox', { name: 'Voice provider' });
    expect(
      Array.from(
        picker.querySelectorAll('option'),
        (option) => option.textContent,
      ),
    ).toEqual(['GPT-Live', 'OpenAI Realtime']);
    expect(
      h.view.getByRole('option', { name: 'GPT-Live', selected: true }),
    ).toBeTruthy();
  });

  it('switches the shop voice session from the picker', async () => {
    const switchProvider = vi.fn(async () => {});
    voiceResult.switchProvider = switchProvider;
    const h = await renderShop();

    fireEvent.change(h.view.getByRole('combobox', { name: 'Voice provider' }), {
      target: { value: 'realtime' },
    });

    expect(switchProvider).toHaveBeenCalledWith('realtime');
  });

  it('renders DevTools without the debug query', async () => {
    const h = await renderShop();

    expect(h.view.getByTestId('shop-devtools')).toBeTruthy();
  });
});

async function renderShop() {
  setPlaygroundKey('test-only-not-a-provider-key');
  const engine = scriptedEngine();
  connector = engine.connector;
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ShopPage />);
  });
  const input = () =>
    view.getByRole('combobox', {
      name: 'Ask the pet shop',
    }) as HTMLInputElement;
  return {
    view,
    engine,
    input,
    type: (text: string) =>
      fireEvent.change(input(), { target: { value: text } }),
    send: () =>
      act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Send' }));
      }),
    thinking: () =>
      view.container
        .querySelector('.chart-wrapper')
        ?.getAttribute('data-thinking') === 'true',
  };
}

function mountedOrchestrator(): Orchestrator {
  if (!orchestrator) throw new Error('expected the shop Provider to mount');
  return orchestrator;
}

function scriptedEngine({ gatedConnect = false } = {}) {
  const inputs: AgentUtteranceInput[] = [];
  const handlers = new Set<(event: AgentEvent) => void>();
  const inputRejections: Error[] = [];
  let chartRequests = 0;
  let openConnection = () => {};
  const connected = gatedConnect
    ? new Promise<void>((resolve) => {
        openConnection = resolve;
      })
    : Promise.resolve();
  const engineConnector = createTestConnector({
    connect: () => connected,
    process: () => {
      chartRequests++;
      return new Promise(() => {});
    },
    sendInput: async (input) => {
      const rejection = inputRejections.shift();
      if (rejection) throw rejection;
      if (input.type === 'utterance') inputs.push(input);
    },
    onEvent: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  });
  return {
    connector: engineConnector,
    get chartRequests() {
      return chartRequests;
    },
    openConnection: () => openConnection(),
    rejectNextInput: (error: Error) => {
      inputRejections.push(error);
    },
    utterances: () => inputs.map(({ text, source }) => ({ text, source })),
    inputIds: () => inputs.map((input) => input.inputId),
    emit: (...events: AgentEvent[]) =>
      act(async () => {
        for (const event of events) {
          for (const handler of handlers) handler(event);
        }
      }),
  };
}

function failedFinish(
  runId: RunId,
  failure: { readonly error: string; readonly code: string },
): AgentEvent {
  return {
    type: 'finished',
    version: AGENT_WIRE_VERSION,
    runId,
    ok: false,
    reason: 'error',
    metrics: NO_METRICS,
    ...failure,
  };
}

function accepted(inputId: MessageId | undefined, runId: RunId): AgentEvent {
  if (inputId === undefined) throw new Error('expected a sent input');
  return {
    type: 'accepted',
    version: AGENT_WIRE_VERSION,
    inputId,
    runId,
    disposition: 'ui_only',
    ack: '',
  };
}
