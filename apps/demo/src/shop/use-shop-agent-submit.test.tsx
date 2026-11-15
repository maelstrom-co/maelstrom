// @vitest-environment happy-dom

import type { MessageId as MessageIdType } from '@maelstrom-co/client';
import { MessageId, RunId } from '@maelstrom-co/protocol';
import type {
  AgentRunState,
  AgentRunsSnapshot,
  AgentRunStatus,
} from '@maelstrom-co/react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let connectionStatus: ConnectionStatus;
let agentRuns: AgentRunsSnapshot;
const listeners = new Set<() => void>();
const sendMessage =
  vi.fn<(text: string, options?: object) => Promise<MessageIdType>>();

vi.doMock('./maelstrom', () => ({
  shopM: {
    useMaelstrom: () => ({
      connectionStatus: useSyncExternalStore(subscribe, () => connectionStatus),
    }),
    useAgentRun: () => ({
      ...useSyncExternalStore(subscribe, () => agentRuns),
      sendMessage,
    }),
  },
}));

const { useShopAgentSubmit } = await import('./use-shop-agent-submit');

beforeEach(() => {
  connectionStatus = 'connected';
  agentRuns = { run: null, runs: [], error: null };
  sendMessage.mockReset();
  sendMessage.mockResolvedValue(MessageId('input-1'));
});

afterEach(() => {
  cleanup();
});

describe('useShopAgentSubmit', () => {
  it('sends the trimmed draft as text input and clears the draft', async () => {
    const h = renderSubmit('  show my orders  ');

    let handed = false;
    await act(async () => {
      handed = h.result.current.submit();
    });

    expect(handed).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('show my orders', {
      source: 'text',
    });
    expect(h.result.current.intent).toBe('');
  });

  it('sends nothing for a blank draft', async () => {
    const h = renderSubmit('   ');

    let handed = true;
    await act(async () => {
      handed = h.result.current.submit();
    });

    expect(handed).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('blocks the submit and keeps the draft while a key is needed', async () => {
    const h = renderSubmit('show my orders', { needsKey: true });

    let handed = true;
    await act(async () => {
      handed = h.result.current.submit();
    });

    expect(handed).toBe(false);
    expect(h.onBlockedSubmit).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(h.result.current.intent).toBe('show my orders');
  });

  it('keeps the draft and sends nothing while the Orchestrator is not connected', async () => {
    connectionStatus = 'connecting';
    const h = renderSubmit('show my orders');

    let handed = true;
    await act(async () => {
      handed = h.result.current.submit();
    });

    expect(handed).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(h.result.current.intent).toBe('show my orders');
  });

  it('restores the draft when the send is rejected', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me');
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      send.reject(new Error('Orchestrator is not connected'));
    });

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('keeps newer typing when a rejected send settles', async () => {
    const send = deferredSend();
    const h = renderSubmit('old');
    await act(async () => {
      h.result.current.submit();
    });
    act(() => h.result.current.changeDraft('newer'));

    await act(async () => {
      send.reject(new Error('socket closed'));
    });

    expect(h.result.current.intent).toBe('newer');
  });

  it('does not restore an older rejected send over a later submission', async () => {
    const first = deferredSend();
    const h = renderSubmit('old');
    await act(async () => {
      h.result.current.submit();
    });
    act(() => h.result.current.changeDraft('later'));
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      first.reject(new Error('socket closed'));
    });

    expect(h.result.current.intent).toBe('');
  });

  it('restores the draft and reports the mint error when the run fails on a rejected key', async () => {
    const h = renderSubmit('restore me', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    act(() => publishRun(failedRun('input-1', INVALID_KEY)));

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).toHaveBeenCalledWith('Invalid API key.');
  });

  it('reports a rejected key that failed the run before the send resolved', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => publishRun(failedRun('input-1', INVALID_KEY)));

    await act(async () => {
      send.resolve(MessageId('input-1'));
    });

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).toHaveBeenCalledOnce();
  });

  it('ignores a rejected key reported for another input', async () => {
    const h = renderSubmit('keep cleared', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    act(() => publishRun(failedRun('voice-input', INVALID_KEY)));

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('leaves the draft cleared for a failure unrelated to the key', async () => {
    const h = renderSubmit('rate limited', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    act(() =>
      publishRun(
        failedRun('input-1', {
          message: '429 rate limit reached',
          code: 'ProviderError',
        }),
      ),
    );

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('does not treat a rejected key as a key problem outside browser-key mode', async () => {
    const h = renderSubmit('server key', { browserKeyMode: false });
    await act(async () => {
      h.result.current.submit();
    });

    act(() => publishRun(failedRun('input-1', INVALID_KEY)));

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('reports the mint error but keeps newer typing when an older run fails on a rejected key', async () => {
    const h = renderSubmit('old', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => h.result.current.changeDraft('newer'));

    act(() => publishRun(failedRun('input-1', INVALID_KEY)));

    expect(h.result.current.intent).toBe('newer');
    expect(h.onMintError).toHaveBeenCalledWith('Invalid API key.');
  });
});

const INVALID_KEY = { message: '401 invalid API key', code: 'ProviderError' };

function renderSubmit(
  initialIntent: string,
  {
    needsKey = false,
    browserKeyMode = false,
  }: { needsKey?: boolean; browserKeyMode?: boolean } = {},
) {
  const onBlockedSubmit = vi.fn();
  const onMintError = vi.fn();
  const view = renderHook(() => {
    const [intent, setIntent] = useState(initialIntent);
    const api = useShopAgentSubmit({
      intent,
      onIntentChange: setIntent,
      needsKey,
      browserKeyMode,
      onBlockedSubmit,
      onMintError,
    });
    return { intent, ...api };
  });
  return { ...view, onBlockedSubmit, onMintError };
}

function deferredSend() {
  let resolve!: (inputId: MessageIdType) => void;
  let reject!: (error: Error) => void;
  sendMessage.mockImplementationOnce(
    () =>
      new Promise<MessageIdType>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      }),
  );
  return {
    resolve: (inputId: MessageIdType) => resolve(inputId),
    reject: (error: Error) => reject(error),
  };
}

function failedRun(
  inputId: string,
  error: { message: string; code?: string },
): AgentRunState {
  return run(inputId, 'failed', error);
}

function run(
  inputId: string,
  status: AgentRunStatus,
  error: { message: string; code?: string } | null = null,
): AgentRunState {
  return {
    inputId: MessageId(inputId),
    runId: RunId(`run-${inputId}`),
    status,
    placeholder: null,
    reply: '',
    turnId: null,
    changes: [],
    changeErrors: [],
    error,
    lostReason: null,
    finished: null,
  };
}

function publishRun(next: AgentRunState): void {
  const runs = [
    ...agentRuns.runs.filter((known) => known.inputId !== next.inputId),
    next,
  ];
  agentRuns = { ...agentRuns, runs, run: next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
