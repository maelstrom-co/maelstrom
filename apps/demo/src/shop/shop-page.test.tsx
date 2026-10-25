// @vitest-environment happy-dom

import {
  type EngineConnector,
  type IntentSubmission,
  type Orchestrator,
  WireEngineError,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
  TilingLayout,
} from '@maelstrom-co/protocol';
import { createMaelstrom } from '@maelstrom-co/react';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { LiveTransportError } from '@maelstrom-co/realtime-protocol/openai-live';
import { Store } from '@tanstack/react-store';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';

interface VoiceResultStub {
  state: string;
  error: unknown;
  connect: () => Promise<void>;
}

let voiceResult: VoiceResultStub;
let connector: EngineConnector;
let orchestrator: Orchestrator | undefined;
let chartHostWidth = 1024;
const seededLayouts: Array<TilingLayout | undefined> = [];
const m = createMaelstrom({ vessels: [] }).with((context) => ({
  useContext: context.useMaelstromContext,
}));
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
vi.doMock('../lib/hosted-mode', () => ({
  isHosted: () => false,
  usesBrowserKey: () => true,
  usesBrowserOpenAIVoice: () => true,
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
vi.doMock('./shop-voice-corner', () => ({ ShopVoiceCorner: () => null }));
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

const INVALID_KEY = () =>
  new WireEngineError('401 invalid API key', 'ProviderError');

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
  vi.stubGlobal('ResizeObserver', MeasuredResizeObserver);
  chartHostWidth = 1024;
  seededLayouts.length = 0;
  orchestrator = undefined;
  voiceResult = { state: 'idle', error: undefined, connect: async () => {} };
});

afterEach(() => {
  cleanup();
  clearPlaygroundKey();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ShopPage typed intents', () => {
  it('restores an untouched draft and reopens the key drawer when the Engine rejects the key', async () => {
    const h = await renderShop();
    h.type('restore me');
    await h.send();
    expect(h.input().value).toBe('');

    await act(async () => {
      h.engine.pending[0].reject(INVALID_KEY());
    });

    expect(h.input().value).toBe('restore me');
    expect(h.view.getByTestId('key-error').textContent).toBe(
      'Invalid API key.',
    );
    expect(h.engine.sent).toHaveLength(1);
  });

  it('keeps newer typing when an older submission fails on a rejected key', async () => {
    const h = await renderShop();
    h.type('old');
    await h.send();
    h.type('newer');

    await act(async () => {
      h.engine.pending[0].reject(INVALID_KEY());
    });

    expect(h.input().value).toBe('newer');
    expect(h.view.getByTestId('key-error').textContent).toBe(
      'Invalid API key.',
    );
  });

  it('does not restore an older failed submission over a later accepted one', async () => {
    const h = await renderShop();
    h.type('old');
    await h.send();
    h.type('later accepted');
    await h.send();

    await act(async () => {
      h.engine.pending[0].reject(INVALID_KEY());
    });

    expect(h.input().value).toBe('');
  });

  it('leaves the draft cleared and the drawer closed for an Engine failure unrelated to the key', async () => {
    const h = await renderShop();
    h.type('rate limited');
    await h.send();

    await act(async () => {
      h.engine.pending[0].reject(
        new WireEngineError('429 rate limit reached', 'ProviderError'),
      );
    });

    expect(h.input().value).toBe('');
    expect(h.view.queryByRole('dialog')).toBeNull();
  });

  it('retries a resumed intent the queue refused once processing changes', async () => {
    const engine = scriptedEngine({ gatedConnect: true });
    connector = engine.connector;
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<ShopPage />);
    });
    fireEvent.change(view.getByRole('textbox', { name: 'Ask the pet shop' }), {
      target: { value: 'resume me' },
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Send' }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Save key' }));
    });
    const client = orchestrator;
    if (!client) throw new Error('expected the shop Provider to mount');
    const enqueue = vi
      .spyOn(client, 'enqueueIntent')
      .mockImplementationOnce(() => refusedTicket());

    await act(async () => {
      engine.openConnection();
    });

    expect(enqueue).toHaveBeenCalledOnce();
    expect(engine.sent).toHaveLength(0);
    const input = () =>
      view.getByRole('combobox', {
        name: 'Ask the pet shop',
      }) as HTMLInputElement;
    expect(input().value).toBe('resume me');

    await act(async () => {
      client.enqueueIntent('show the catalog');
    });
    await act(async () => {
      engine.finish(0);
    });

    expect(input().value).toBe('');
    expect(engine.sentIntents()).toEqual(['show the catalog', 'resume me']);
  });
});

describe('ShopPage voice key errors', () => {
  it.each([
    [
      'an HTTP 401 exchange',
      new LiveTransportError('exchange_rejected', { status: 401 }),
    ],
    ['a missing key', new LiveTransportError('missing_key')],
  ])('reopens the key drawer with the Live key message for %s', async (_case, cause) => {
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
  });

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
  };
}

function scriptedEngine({ gatedConnect = false } = {}) {
  const sent: ChartRequestMessage[] = [];
  const pending: Array<{
    resolve: (response: MaelstromResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  let openConnection = () => {};
  const connected = gatedConnect
    ? new Promise<void>((resolve) => {
        openConnection = resolve;
      })
    : Promise.resolve();
  const engineConnector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: () => connected,
    disconnect: async () => {},
    addAssistantMessage: async () => {},
    getHistory: async () => [],
    subscribe: () => () => {},
    process: (request) => {
      sent.push(request);
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  };
  return {
    connector: engineConnector,
    sent,
    pending,
    openConnection: () => openConnection(),
    finish: (index: number) =>
      pending[index].resolve({
        type: 'maelstrom_response',
        requestId: sent[index].id,
        layout: { type: 'grid', positions: [] },
        executionPlan: [],
        rationale: '',
        userMessage: `Reply ${index}`,
      }),
    sentIntents: () =>
      sent.map((request) => {
        const reason = request.request.context.updateReasons.at(-1);
        return reason?.type === 'user_intent' ? reason.intent : reason?.type;
      }),
  };
}

function refusedTicket(): IntentSubmission {
  const refusal = { status: 'not_submitted', reason: 'queue_full' } as const;
  return Object.freeze({
    id: 'refused-intent',
    accepted: false,
    store: new Store(refusal),
    result: Promise.resolve(refusal),
  });
}
