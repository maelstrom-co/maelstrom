// @vitest-environment happy-dom

import type { AgentMessageSubmission } from '@maelstrom-co/client';
import { MessageId, RunId } from '@maelstrom-co/protocol';
import type {
  AgentRunError,
  AgentRunLostReason,
  AgentRunState,
  SettledAgentRun,
} from '@maelstrom-co/react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let connectionStatus: ConnectionStatus;
const listeners = new Set<() => void>();
const sendMessage =
  vi.fn<(text: string, options?: object) => AgentMessageSubmission>();
let storeRuns: readonly AgentRunState[] = [];

vi.doMock('./maelstrom', () => ({
  shopM: {
    useMaelstrom: () => ({
      connectionStatus: useSyncExternalStore(subscribe, () => connectionStatus),
    }),
    useAgentRun: () => {
      const runs = useSyncExternalStore(subscribe, () => storeRuns);
      return { run: runs.at(-1) ?? null, runs, error: null, sendMessage };
    },
  },
}));

const { useShopAgentSubmit } = await import('./use-shop-agent-submit');

beforeEach(() => {
  connectionStatus = 'connected';
  storeRuns = [];
  sendMessage.mockReset();
  sendMessage.mockImplementation(() => ({
    inputId: MessageId('input-1'),
    result: new Promise<SettledAgentRun>(() => undefined),
  }));
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

  it('restores the draft when the message was not submitted', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me');
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      send.settle(notSubmittedRun('input-1'));
    });

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('restores the draft when the transport refused the message', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me');
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      send.settle(lostRun('input-1', 'send_failed'));
    });

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it.each(['disconnected', 'connector_replaced', 'stale_run'] as const)(
    'leaves the draft cleared when the run is lost to %s',
    async (lostReason) => {
      const send = deferredSend();
      const h = renderSubmit('maybe seen', { browserKeyMode: true });
      await act(async () => {
        h.result.current.submit();
      });

      await act(async () => {
        send.settle(lostRun('input-1', lostReason));
      });

      expect(h.result.current.intent).toBe('');
      expect(h.onMintError).not.toHaveBeenCalled();
    },
  );

  it('restores the draft when the message settles not submitted before the cleared draft commits', async () => {
    const result = Promise.resolve(notSubmittedRun('input-1'));
    sendMessage.mockReturnValueOnce({ inputId: MessageId('input-1'), result });
    const h = renderSubmit('restore me');

    await act(async () => {
      h.result.current.submit();
      await result;
      for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    });

    expect(h.result.current.intent).toBe('restore me');
  });

  it('keeps newer typing when an unsent message settles', async () => {
    const send = deferredSend();
    const h = renderSubmit('old');
    await act(async () => {
      h.result.current.submit();
    });
    act(() => h.result.current.changeDraft('newer'));

    await act(async () => {
      send.settle(lostRun('input-1', 'send_failed'));
    });

    expect(h.result.current.intent).toBe('newer');
  });

  it('does not restore an older unsent message over a later submission', async () => {
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
      first.settle(notSubmittedRun('input-1'));
    });

    expect(h.result.current.intent).toBe('');
  });

  it.each([
    ['UI-only route', UI_ROUTE_PROVIDER_FAILURE],
    ['agent route', AGENT_ROUTE_PROVIDER_FAILURE],
  ])(
    'restores the draft and reports the model failure when the run fails on the %s provider code',
    async (_route, failure) => {
      const send = deferredSend();
      const h = renderSubmit('restore me', { browserKeyMode: true });
      await act(async () => {
        h.result.current.submit();
      });

      await act(async () => {
        send.settle(failedRun('input-1', failure));
      });

      expect(h.result.current.intent).toBe('restore me');
      expect(h.onMintError).toHaveBeenCalledWith(MODEL_FAILURE_COPY);
    },
  );

  it('leaves the draft cleared when the run finished', async () => {
    const send = deferredSend();
    const h = renderSubmit('done', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      send.settle(finishedRun('input-1'));
    });

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('leaves the draft cleared for a failure other than the model provider', async () => {
    const send = deferredSend();
    const h = renderSubmit('timed out', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      send.settle(
        failedRun('input-1', {
          message: 'The UI acknowledgement did not arrive.',
          code: 'ui_ack_timeout',
        }),
      );
    });

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('does not treat a provider failure as a key problem outside browser-key mode', async () => {
    const send = deferredSend();
    const h = renderSubmit('server key', { browserKeyMode: false });
    await act(async () => {
      h.result.current.submit();
    });

    await act(async () => {
      send.settle(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE));
    });

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('reports the model failure but keeps newer typing when an older run fails on a provider code', async () => {
    const send = deferredSend();
    const h = renderSubmit('old', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    act(() => h.result.current.changeDraft('newer'));

    await act(async () => {
      send.settle(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE));
    });

    expect(h.result.current.intent).toBe('newer');
    expect(h.onMintError).toHaveBeenCalledWith(MODEL_FAILURE_COPY);
  });

  it('keeps watching a stale-lost run and reports a later provider failure in browser-key mode', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });

    const stale = lostRun('input-1', 'stale_run');
    await act(async () => {
      publishRuns([stale]);
      send.settle(stale);
    });
    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();

    act(() => {
      publishRuns([failedRun('input-1', AGENT_ROUTE_PROVIDER_FAILURE)]);
    });

    expect(h.result.current.intent).toBe('restore me');
    expect(h.onMintError).toHaveBeenCalledWith(MODEL_FAILURE_COPY);
  });

  it('stops watching a stale-lost run once it finishes', async () => {
    const send = deferredSend();
    const h = renderSubmit('keep cleared', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    const stale = lostRun('input-1', 'stale_run');
    await act(async () => {
      publishRuns([stale]);
      send.settle(stale);
    });

    act(() => publishRuns([finishedRun('input-1')]));
    act(() =>
      publishRuns([failedRun('input-1', AGENT_ROUTE_PROVIDER_FAILURE)]),
    );

    expect(h.result.current.intent).toBe('');
    expect(h.onMintError).not.toHaveBeenCalled();
  });

  it('ignores a result that settles after unmount', async () => {
    const send = deferredSend();
    const h = renderSubmit('restore me', { browserKeyMode: true });
    await act(async () => {
      h.result.current.submit();
    });
    h.unmount();

    await act(async () => {
      send.settle(failedRun('input-1', UI_ROUTE_PROVIDER_FAILURE));
    });

    expect(h.onMintError).not.toHaveBeenCalled();
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
  let settle!: (run: SettledAgentRun) => void;
  sendMessage.mockImplementationOnce(() => ({
    inputId: MessageId('input-1'),
    result: new Promise<SettledAgentRun>((resolve) => {
      settle = resolve;
    }),
  }));
  return { settle: (run: SettledAgentRun) => settle(run) };
}

function base(inputId: string) {
  return {
    inputId: MessageId(inputId),
    placeholder: null,
    reply: '',
    turnId: null,
    changes: [],
    changeErrors: [],
  };
}

function accepted(inputId: string) {
  return {
    runId: RunId(`run-${inputId}`),
    disposition: 'agent' as const,
    ack: 'On it.',
  };
}

const NOT_ACCEPTED = { runId: null, disposition: null, ack: null };

const OUTCOME = {
  reason: 'completed' as const,
  metrics: {
    turns: 1,
    toolCalls: { requested: 0, admitted: 0 },
    elapsedMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  },
};

function failedRun(inputId: string, error: AgentRunError): SettledAgentRun {
  return {
    ...base(inputId),
    ...accepted(inputId),
    status: 'failed',
    error,
    outcome: null,
  };
}

function finishedRun(inputId: string): SettledAgentRun {
  return {
    ...base(inputId),
    ...accepted(inputId),
    status: 'finished',
    outcome: OUTCOME,
  };
}

function lostRun(
  inputId: string,
  lostReason: AgentRunLostReason,
): SettledAgentRun {
  return { ...base(inputId), ...NOT_ACCEPTED, status: 'lost', lostReason };
}

function notSubmittedRun(inputId: string): SettledAgentRun {
  return {
    ...base(inputId),
    ...NOT_ACCEPTED,
    status: 'not_submitted',
    error: { message: 'Orchestrator is not connected' },
  };
}

function publishRuns(runs: readonly AgentRunState[]): void {
  storeRuns = runs;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
