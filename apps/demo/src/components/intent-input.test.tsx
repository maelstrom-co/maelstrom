// @vitest-environment happy-dom

import {
  type EngineConnector,
  type IntentQueueOptions,
  type Orchestrator,
  WireEngineError,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { createMaelstrom } from '@maelstrom-co/react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type DemoMaelstrom,
  DemoMaelstromProvider,
} from '../lib/demo-maelstrom-context';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';

const INTENT_EXAMPLES = ['Plan my afternoon', 'Hide the weather'];

let voiceState = 'idle';
const m = createMaelstrom({ vessels: [] }).with((context) => ({
  useContext: context.useMaelstromContext,
}));
const demoMaelstrom = {
  ...m,
  useVoice: () => ({ state: voiceState }),
  VoiceOrb: () => <button type="button">Voice</button>,
} as unknown as DemoMaelstrom;
vi.doMock('../lib/hosted-mode', () => ({ usesBrowserKey: () => true }));
vi.doMock('./voice-control', () => ({ VoiceControl: () => null }));
vi.doMock('./voice-error-note', () => ({ VoiceErrorNote: () => null }));
vi.doMock('./captions', () => ({ Captions: () => null }));
const { IntentInput } = await import('./intent-input');

afterEach(() => {
  cleanup();
  voiceState = 'idle';
  clearPlaygroundKey();
  vi.useRealTimers();
});

async function setup(
  policy?: IntentQueueOptions,
  resume = false,
  strict = false,
) {
  setPlaygroundKey('test-only-not-a-provider-key');
  const sent: ChartRequestMessage[] = [];
  const pending: Array<{
    resolve: (response: MaelstromResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
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
  let client!: Orchestrator;
  const onMintError = vi.fn();
  const onBlockedSubmit = vi.fn();
  const onResumeIntentHandled = vi.fn();
  const onDraft = vi.fn();
  function Composer() {
    client = m.useContext().orchestrator;
    const [intent, setIntent] = useState(resume ? 'resume me' : '');
    return (
      <IntentInput
        intent={intent}
        onIntentChange={(value) => {
          onDraft(value);
          setIntent(value);
        }}
        onMintError={onMintError}
        onBlockedSubmit={onBlockedSubmit}
        resumeIntent={resume}
        onResumeIntentHandled={onResumeIntentHandled}
        examples={INTENT_EXAMPLES}
      />
    );
  }
  let view!: ReturnType<typeof render>;
  const tree = (key: string) => (
    <DemoMaelstromProvider maelstrom={demoMaelstrom}>
      <m.Provider key={key} connector={connector} intentQueue={policy}>
        <Composer />
      </m.Provider>
    </DemoMaelstromProvider>
  );
  await act(async () => {
    view = render(
      strict ? <StrictMode>{tree('first')}</StrictMode> : tree('first'),
    );
  });
  const input = () => view.getByRole('combobox') as HTMLInputElement;
  const type = (text: string) =>
    fireEvent.change(input(), { target: { value: text } });
  const send = () =>
    act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Send' }));
    });
  const finish = (index: number) =>
    pending[index].resolve({
      type: 'maelstrom_response',
      requestId: sent[index].id,
      layout: { type: 'grid', positions: [] },
      executionPlan: [],
      rationale: '',
      userMessage: `Reply ${index}`,
    });
  return {
    view,
    input,
    type,
    send,
    sent,
    pending,
    finish,
    client,
    onMintError,
    onBlockedSubmit,
    onResumeIntentHandled,
    onDraft,
    tree,
  };
}

it('offers the configured examples as intent suggestions', async () => {
  const h = await setup();
  const suggestions = Array.from(
    h.view.container.querySelectorAll('#demo-intent-examples option'),
    (option) => option.getAttribute('value'),
  );
  expect(suggestions).toEqual(INTENT_EXAMPLES);
});

it('keeps typing and Send usable during a 3s resize; shows FIFO queued, processing and applied without erasing new drafts', async () => {
  vi.useFakeTimers();
  const h = await setup();
  await act(async () => {
    h.client.chartManager.setDimensions({ columns: 10, rows: 6 });
    await vi.advanceTimersByTimeAsync(350);
  });
  h.type('first typed');
  await h.send();
  expect(h.input().disabled).toBe(false);
  expect(h.input().value).toBe('');
  expect(h.view.getByRole('status').textContent).toContain(
    '“first typed”: Queued (#1)',
  );
  h.type('second typed');
  await h.send();
  h.type('new draft');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(h.sent).toHaveLength(1);
  await act(async () => {
    h.finish(0);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“first typed”: Processing',
  );
  expect(h.view.getByRole('status').textContent).toContain(
    '“second typed”: Queued (#1)',
  );
  await act(async () => {
    h.finish(1);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“first typed”: Applied — Reply 1',
  );
  expect(h.view.getByRole('status').textContent).toContain(
    '“second typed”: Processing',
  );
  await act(async () => {
    h.finish(2);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“second typed”: Applied — Reply 2',
  );
  expect(h.input().value).toBe('new draft');
  expect(
    h.sent
      .slice(1)
      .map((request) => request.request.context.updateReasons.at(-1)),
  ).toEqual([
    { type: 'user_intent', intent: 'first typed' },
    { type: 'user_intent', intent: 'second typed' },
  ]);
});

it('shows quoted intent and status without internal ticket IDs', async () => {
  const h = await setup();
  h.type('first');
  await h.send();
  expect(h.view.getByRole('status').textContent).toBe(
    'Maelstrom“first”: Processing',
  );
  h.type('second');
  await h.send();
  expect(h.view.getByRole('status').textContent).toBe(
    'Maelstrom“first”: Processing · “second”: Queued (#1)',
  );
  await act(async () => {
    h.finish(0);
  });
  expect(h.view.getByRole('status').textContent).toBe(
    'Maelstrom“first”: Applied — Reply 0 · “second”: Processing',
  );
  await act(async () => {
    h.finish(1);
  });
});

it('retains full-queue drafts and distinguishes expiry and unknown without retries', async () => {
  vi.useFakeTimers();
  const h = await setup({
    capacity: 1,
    maxWaitMs: 2000,
    activeTimeoutMs: 4000,
  });
  h.type('active');
  await h.send();
  h.type('expires');
  await h.send();
  h.type('full draft');
  await h.send();
  expect(h.input().value).toBe('full draft');
  expect(h.view.getByRole('status').textContent).toContain(
    'Queue full — draft kept',
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“expires”: Queue expired — not submitted',
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“active”: Outcome unknown',
  );
  expect(h.view.getByRole('status').textContent).toContain(
    'Check the workspace before retrying',
  );
  expect(h.sent).toHaveLength(1);
  await act(async () => {
    h.finish(0);
  });
  expect(h.view.getByRole('status').textContent).not.toContain('Applied');
});

it('restores an untouched rejected-key draft and reopens the key drawer without replay', async () => {
  const h = await setup();
  h.type('restore me');
  await h.send();
  await act(async () => {
    h.pending[0].reject(
      new WireEngineError('401 invalid API key', 'ProviderError'),
    );
  });
  expect(h.input().value).toBe('restore me');
  expect(h.onMintError).toHaveBeenCalledExactlyOnceWith('Invalid API key.');
  expect(h.sent).toHaveLength(1);
});

it('does not restore an older failure over newer text, even if the visitor subsequently clears it', async () => {
  const h = await setup();
  h.type('old');
  await h.send();
  h.type('new');
  h.type('');
  await act(async () => {
    h.pending[0].reject(
      new WireEngineError('401 invalid API key', 'ProviderError'),
    );
  });
  expect(h.input().value).toBe('');
  expect(h.onMintError).toHaveBeenCalledOnce();
});

it('does not restore an older failed submission over a later accepted submission', async () => {
  const h = await setup();
  h.type('old');
  await h.send();
  h.type('new accepted');
  await h.send();
  await act(async () => {
    h.pending[0].reject(
      new WireEngineError('401 invalid API key', 'ProviderError'),
    );
  });
  expect(h.input().value).toBe('');
  expect(h.sent).toHaveLength(2);
  await act(async () => {
    h.finish(1);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“new accepted”: Applied',
  );
  expect(h.view.getByRole('status').textContent).toContain(
    '“old”: Outcome unknown',
  );
});

it('fences old result callbacks across Provider remount and unmount', async () => {
  const h = await setup();
  h.type('old');
  await h.send();
  await act(async () => {
    h.view.rerender(h.tree('replacement'));
  });
  h.type('new session draft');
  h.onDraft.mockClear();
  await act(async () => {
    h.pending[0].reject(
      new WireEngineError('401 invalid API key', 'ProviderError'),
    );
  });
  expect(h.input().value).toBe('new session draft');
  expect(h.onMintError).not.toHaveBeenCalled();
  expect(h.onDraft).not.toHaveBeenCalled();
  expect(h.view.queryByRole('status')).toBeNull();
  await h.send();
  h.view.unmount();
  h.onDraft.mockClear();
  await act(async () => {
    h.pending[1].reject(
      new WireEngineError('401 invalid API key', 'ProviderError'),
    );
  });
  expect(h.onMintError).not.toHaveBeenCalled();
  expect(h.onDraft).not.toHaveBeenCalled();
});

it('keeps key gating and resumes once on connection, clearing only the admitted draft', async () => {
  const h = await setup(undefined, true);
  expect(h.onResumeIntentHandled).toHaveBeenCalledOnce();
  expect(h.sent).toHaveLength(1);
  expect(h.input().value).toBe('');
  await act(async () => {
    clearPlaygroundKey();
  });
  h.type('needs key');
  await h.send();
  expect(h.onBlockedSubmit).toHaveBeenCalledOnce();
  expect(h.input().value).toBe('needs key');
  expect(h.sent).toHaveLength(1);
});

it('bounds completed feedback while retaining pending work', async () => {
  const h = await setup();
  for (let index = 0; index < 9; index++) {
    h.type(`request ${index}`);
    await h.send();
    await act(async () => {
      h.finish(index);
    });
  }
  expect(h.view.getByRole('status').textContent).not.toContain('“request 2”');
  expect(h.view.getByRole('status').textContent).toContain(
    '“request 3”: Applied',
  );
  expect(h.view.getByRole('status').textContent).toContain(
    '“request 8”: Applied',
  );
  h.type('active');
  await h.send();
  h.type('pending');
  await h.send();
  expect(h.view.getByRole('status').textContent).toContain(
    '“active”: Processing',
  );
  expect(h.view.getByRole('status').textContent).toContain('“pending”: Queued');
});

it('keeps queued, processing and uncertain typed work visible during voice but hides applied history', async () => {
  const h = await setup();
  h.type('success');
  await h.send();
  await act(async () => {
    h.finish(0);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“success”: Applied',
  );
  voiceState = 'connected';
  h.type('active');
  await h.send();
  h.type('queued');
  await h.send();
  expect(h.view.getByRole('status').textContent).not.toContain('“success”');
  expect(h.view.getByRole('status').textContent).toContain(
    '“active”: Processing',
  );
  expect(h.view.getByRole('status').textContent).toContain('“queued”: Queued');
  await act(async () => {
    h.pending[1].reject(new Error('connection lost'));
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“active”: Outcome unknown',
  );
  expect(h.view.getByRole('status').textContent).toContain(
    '“queued”: Processing',
  );
  await act(async () => {
    h.finish(2);
  });
  expect(h.view.getByRole('status').textContent).not.toContain('“queued”');
});

it('does not claim applied after network completion while atomic commands are settling', async () => {
  const h = await setup();
  let settle!: () => void;
  vi.spyOn(h.client.commandProcessor, 'dispatchSettled').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = () => resolve({ status: 'applied' });
      }),
  );
  h.type('settling');
  await h.send();
  h.type('next');
  await h.send();
  await act(async () => {
    h.finish(0);
  });
  expect(h.client.requestCoordinator.isProcessing).toBe(false);
  expect(h.sent).toHaveLength(1);
  expect(h.view.getByRole('status').textContent).toContain(
    '“settling”: Processing',
  );
  expect(h.view.getByRole('status').textContent).not.toContain('Applied');
  await act(async () => {
    settle();
  });
  expect(h.sent).toHaveLength(2);
  expect(h.view.getByRole('status').textContent).toContain(
    '“settling”: Applied',
  );
});

it('keeps known refusal and full admission feedback visible during voice', async () => {
  voiceState = 'connected';
  const h = await setup({ capacity: 1 });
  vi.spyOn(h.client.commandProcessor, 'dispatchSettled').mockResolvedValueOnce({
    status: 'failed',
    error: new Error('layout refused'),
  });
  h.type('refused');
  await h.send();
  h.type('queued');
  await h.send();
  h.type('full');
  await h.send();
  expect(h.view.getByRole('status').textContent).toContain(
    'Queue full — draft kept',
  );
  await act(async () => {
    h.finish(0);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“refused”: Not applied — layout refused',
  );
});

it('resumes exactly once through StrictMode effect replay', async () => {
  const h = await setup(undefined, true, true);
  expect(h.sent).toHaveLength(1);
  expect(h.onResumeIntentHandled).toHaveBeenCalledOnce();
  expect(h.view.getByRole('status').textContent).toContain(
    '“resume me”: Processing',
  );
  await act(async () => {
    h.finish(0);
  });
  expect(h.view.getByRole('status').textContent).toContain(
    '“resume me”: Applied',
  );
});
