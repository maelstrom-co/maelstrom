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
  sendMessage.mockImplementation(async () => registerInput('input-1'));
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

  it('restores the draft when the send rejects before the cleared draft commits', async () => {
    const rejected = Promise.reject(new Error('Orchestrator is not connected'));
    sendMessage.mockReturnValueOnce(rejected);
    const h = renderSubmit('restore me');

    await act(async () => {
      h.result.current.submit();
      await rejected.catch(() => undefined);
      for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    });

    expect(h.result.current.intent).toBe('restore me');
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

  it.each([
    ['UI-only route', UI_ROUTE_PROVIDER_FAILURE],
    ['agent route', AGENT_ROUTE_PROVIDER_FAILURE],
  ])(
    'restores the draft and reports the model failure when the run fails on the %s provider code',
    async (_route, failure) => {
      const h = renderSubmit('restore me', { browserKeyMode: true });
      await act(async () => {
        h.result.current.submit();
      });

      act(() => publishRun(failedRun('input-1', failure)));

      expect(h.result.current.intent).toBe('restore me');
      expect(h.onMintError).toHaveBeenCalledWith(MODEL_FAILURE_COPY);
    },
  );

  it('restores and reports a provider failure after a recoverable stale loss', async () => {
    const h = renderSubmit('restore me', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => publishRun(lostRun('input-1', 'stale_run')));
    expect(h.onMintError).not.toHaveBeenCalled();

    act(() => publishRun(failedRun('input-1', AGENT_ROUTE_PROVIDER_FAILURE)));

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).toHaveBeenCalledWith(MODEL_FAILURE_COPY);
  });

  it('stops watching a run once it finished', async () => {
    const h = renderSubmit('done', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => publishRun(run('input-1', 'finished')));

    act(() => publishRun(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE)));

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('stops watching a run that is no longer tracked', async () => {
    const h = renderSubmit('evicted', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => publishRuns([]));

    act(() => publishRun(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE)));

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('reports a provider failure that failed the run before the send resolved', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => publishRun(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE)));

    await act(async () => {
      send.resolve(MessageId('input-1'));
    });

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).toHaveBeenCalledOnce();
  });

  it('ignores a provider failure reported for another input', async () => {
    const h = renderSubmit('keep cleared', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    act(() => publishRun(failedRun('voice-input', UI_ROUTE_PROVIDER_FAILURE)));

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('leaves the draft cleared for a failure other than the model provider', async () => {
    const h = renderSubmit('timed out', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    act(() =>
      publishRun(
        failedRun('input-1', {
          message: 'The UI acknowledgement did not arrive.',
          code: 'ui_ack_timeout',
        }),
      ),
    );

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('does not treat a provider failure as a key problem outside browser-key mode', async () => {
    const h = renderSubmit('server key', { browserKeyMode: false });
    await act(async () => {
      h.result.current.submit();
    });

    act(() => publishRun(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE)));

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('reports the model failure but keeps newer typing when an older run fails on a provider code', async () => {
    const h = renderSubmit('old', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => h.result.current.changeDraft('newer'));

    act(() => publishRun(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE)));

    expect(h.result.current.intent).toBe('newer');
    expect(h.onMintError).toHaveBeenCalledWith(MODEL_FAILURE_COPY);
  });
});

const UI_ROUTE_PROVIDER_FAILURE = {
  message: 'The UI request failed.',
  code: 'ProviderError',
};
const AGENT_ROUTE_PROVIDER_FAILURE = {
  message: 'The model could not respond.',
  code: 'provider_error',
};
const MODEL_FAILURE_COPY =
  'The model request failed. Check your API key and try again.';

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
    resolve: (inputId: MessageIdType) => {
      registerInput(inputId);
      resolve(inputId);
    },
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

function lostRun(
  inputId: string,
  lostReason: NonNullable<AgentRunState['lostReason']>,
): AgentRunState {
  return { ...run(inputId, 'lost'), lostReason };
}

// Mirrors the agent run store, which registers the input before `sendMessage`
// resolves.
function registerInput(inputId: string): MessageIdType {
  const id = MessageId(inputId);
  if (!agentRuns.runs.some((known) => known.inputId === id)) {
    publishRun(run(inputId, 'pending'));
  }
  return id;
}

function publishRun(next: AgentRunState): void {
  publishRuns([
    ...agentRuns.runs.filter((known) => known.inputId !== next.inputId),
    next,
  ]);
}

function publishRuns(runs: readonly AgentRunState[]): void {
  agentRuns = { ...agentRuns, runs, run: runs.at(-1) ?? null };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
