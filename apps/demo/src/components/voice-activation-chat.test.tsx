// @vitest-environment happy-dom

import { SessionId } from '@maelstrom-co/protocol';
import {
  type AdapterConnectOptions,
  RealtimeSession,
  type VoiceActivationConfig,
} from '@maelstrom-co/realtime';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let session: RealtimeSession;
let activation: AdapterConnectOptions['activation'];
let request: ReturnType<typeof deferred>;
let settled: ReturnType<typeof deferred>;
let processIntent: ReturnType<typeof vi.fn>;
let needsKey = false;
let key: string | null = 'test';
const noOp = () => {};
const connect = async () => {};
const configureActivation = (config: VoiceActivationConfig) =>
  session.configureActivation(config);
const beginChatActivity = () => session.beginChatActivity();

vi.mock('../lib/maelstrom', () => ({
  prepareBrowserOpenAIVoice: () => false,
  m: {
    Provider: ({ children }: { children: ReactNode }) => children,
    Chart: () => null,
    VoiceOrb: () => <button type="button">Voice</button>,
    useVoice: () => ({
      state: session.state,
      activationConfig: session.activationConfig,
      activationState: session.activationState,
      configureActivation,
      beginChatActivity,
      connect,
      greetingState: 'not_configured',
      turnMode: 'automatic',
    }),
    useMaelstrom: () => ({
      processIntent,
      isProcessing: false,
      connectionStatus: 'connected',
    }),
    useTouchedInstances: () => [],
  },
}));
vi.mock('@tanstack/react-store', () => ({ useStore: () => key }));
vi.mock('../lib/connector', () => ({ createDemoConnector: () => ({}) }));
vi.mock('../lib/hosted-mode', () => ({
  isHosted: () => false,
  usesBrowserKey: () => needsKey,
  usesBrowserOpenAIVoice: () => false,
}));
vi.mock('../lib/playground-key-store', () => ({
  playgroundKeyStore: {
    get state() {
      return { apiKey: key };
    },
  },
  setPlaygroundKey: (value: string) => {
    key = value;
  },
  clearPlaygroundKey: () => {
    key = null;
  },
}));
vi.mock('../lib/use-touched-instances', () => ({ useFlashInstances: noOp }));
vi.mock('./demo-header', () => ({
  DemoHeader: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./first-run-hint', () => ({
  FIRST_RUN_EXAMPLES: [],
  FirstRunHint: () => null,
}));
vi.mock('./vessel-option-sync', () => ({ VesselOptionSync: () => null }));
vi.mock('./captions', () => ({ Captions: () => null }));
vi.mock('./voice-error-note', () => ({ VoiceErrorNote: () => null }));
vi.mock('./keyless-demo', () => ({
  KeylessDemo: ({
    onIntentChange,
    onBlockedSubmit,
  }: {
    onIntentChange: (text: string) => void;
    onBlockedSubmit: () => void;
  }) => (
    <>
      <input
        aria-label="Draft"
        onChange={(event) => onIntentChange(event.target.value)}
      />
      <button type="button" onClick={onBlockedSubmit}>
        Send draft
      </button>
    </>
  ),
}));
vi.mock('./key-drawer', () => ({
  KeyDrawer: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean;
    onSave: (key: string) => void;
  }) =>
    isOpen ? (
      <button type="button" onClick={() => onSave('test')}>
        Save key
      </button>
    ) : null,
}));
const { HomePage } = await import('./home-page');

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  request = deferred();
  settled = deferred();
  processIntent = vi.fn(() => request.promise);
  needsKey = false;
  key = 'test';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 1000 } }]);
      }
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  await session?.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(includeChatActivity: boolean, normal = false) {
  const adapter = {
    voiceActivationVersion: 1 as const,
    connect: async (options: AdapterConnectOptions) => {
      activation = options.activation;
    },
    disconnect: async () => {},
    on: () => noOp,
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: noOp,
  };
  session = new RealtimeSession({
    sessionId: SessionId('voice-activation-chat'),
    adapter,
    instance: {
      submitIntent: async () => ({}),
      waitForIdle: () => settled.promise,
      getStructuralSnapshot: () => ({}),
      getCapabilitySnapshot: () => ({}),
      onSettled: () => noOp,
    } as never,
    activation: normal
      ? { mode: 'normal' }
      : {
          mode: 'trigger',
          phrase: 'hello maelstrom',
          inactivityMs: 1000,
          includeChatActivity,
        },
  });
  await session.connect();
}

async function wake() {
  activation?.reportInput({
    id: 'wake',
    ordinal: 1,
    start: 0,
    end: 1,
    outcome: 'success',
    text: 'hello maelstrom',
  });
  await act(async () => Promise.resolve());
}

describe('demo typed voice activity', () => {
  it.each([
    false,
    true,
  ])('tracks request and render settlement on the %s resumed path without waking waiting voice', async (resume) => {
    await start(true);
    vi.useFakeTimers();
    needsKey = resume;
    key = resume ? null : 'test';
    const ui = render(<HomePage />);
    if (resume) {
      fireEvent.change(ui.getByLabelText('Draft'), {
        target: { value: 'show weather' },
      });
      fireEvent.click(ui.getByRole('button', { name: 'Send draft' }));
      fireEvent.click(ui.getByRole('button', { name: 'Save key' }));
    } else {
      fireEvent.change(
        ui.getByPlaceholderText('Tell Maelstrom what you want to arrange...'),
        { target: { value: 'show weather' } },
      );
      fireEvent.click(ui.getByRole('button', { name: 'Send' }));
    }
    expect(processIntent).toHaveBeenCalledTimes(1);
    expect(session.activationState).toBe('waiting');
    await wake();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(session.activationState).toBe('active');
    await act(async () => {
      request.resolve();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(session.activationState).toBe('active');
    await act(async () => {
      settled.resolve();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(session.activationState).toBe('waiting');
    expect(ui.getByTestId('ai-voice-disclosure').textContent).toBe(
      'AI-generated voice',
    );
  });

  it('releases a failed request in finally on the resumed path', async () => {
    await start(true);
    vi.useFakeTimers();
    needsKey = true;
    key = null;
    const ui = render(<HomePage />);
    fireEvent.change(ui.getByLabelText('Draft'), {
      target: { value: 'show weather' },
    });
    fireEvent.click(ui.getByRole('button', { name: 'Send draft' }));
    fireEvent.click(ui.getByRole('button', { name: 'Save key' }));
    await wake();
    await act(async () => {
      request.reject(new Error('request failed'));
      settled.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(session.activationState).toBe('waiting');
  });

  it('does not count chat when participation is off', async () => {
    await start(false);
    vi.useFakeTimers();
    const ui = render(<HomePage />);
    fireEvent.change(
      ui.getByPlaceholderText('Tell Maelstrom what you want to arrange...'),
      { target: { value: 'hello maelstrom' } },
    );
    fireEvent.click(ui.getByRole('button', { name: 'Send' }));
    expect(session.activationState).toBe('waiting');
    await wake();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(session.activationState).toBe('waiting');
    await act(async () => request.resolve());
  });

  it('keeps overlapping typed requests independent until each settles', async () => {
    await start(true);
    vi.useFakeTimers();
    const second = deferred();
    processIntent
      .mockImplementationOnce(() => request.promise)
      .mockImplementationOnce(() => second.promise);
    const ui = render(<HomePage />);
    const input = ui.getByPlaceholderText(
      'Tell Maelstrom what you want to arrange...',
    );
    fireEvent.change(input, { target: { value: 'first request' } });
    fireEvent.click(ui.getByRole('button', { name: 'Send' }));
    fireEvent.change(input, { target: { value: 'second request' } });
    fireEvent.click(ui.getByRole('button', { name: 'Send' }));
    await wake();
    await act(async () => {
      request.resolve();
      settled.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(session.activationState).toBe('active');
    await act(async () => second.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(session.activationState).toBe('waiting');
  });

  it('does not let a stale completion release a replacement connection token', async () => {
    await start(true);
    vi.useFakeTimers();
    const ui = render(<HomePage />);
    fireEvent.change(
      ui.getByPlaceholderText('Tell Maelstrom what you want to arrange...'),
      { target: { value: 'old request' } },
    );
    fireEvent.click(ui.getByRole('button', { name: 'Send' }));
    await session.disconnect();
    await session.connect();
    const finishNew = session.beginChatActivity();
    await wake();
    await act(async () => {
      request.resolve();
      settled.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(session.activationState).toBe('active');
    await act(async () => finishNew());
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(session.activationState).toBe('waiting');
  });

  it('keeps normal typed completion independent of voice render settlement', async () => {
    await start(false, true);
    const ui = render(<HomePage />);
    const input = ui.getByPlaceholderText(
      'Tell Maelstrom what you want to arrange...',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'show weather' } });
    fireEvent.click(ui.getByRole('button', { name: 'Send' }));
    await act(async () => request.resolve());
    expect(input.value).toBe('');
    expect(session.activationState).toBe('disabled');
  });
});
