// @vitest-environment happy-dom

import type { EngineConnector } from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
  createMockAgentConnector,
  type MockAgentConnector,
} from '@maelstrom-co/client/_testing';
import { ChangeId, MessageId, RunId } from '@maelstrom-co/protocol';
import { createMaelstrom } from '@maelstrom-co/react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = createMaelstrom({ vessels: [] });

vi.doMock('./maelstrom', () => ({ shopM: m }));

const { ShopAgentReply } = await import('./shop-agent-reply');

const RUN = RunId('run-1');
const STALE_RUN_TIMEOUT_MS = 150_000;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ShopAgentReply', () => {
  it('renders nothing before any input', async () => {
    const view = await renderReply();
    expect(view.reply()).toBeNull();
  });

  it.each(['text', 'voice'] as const)(
    'shows the placeholder, the streamed reply, then the final reply for a %s input',
    async (source) => {
      const view = await renderReply();
      const inputId = await view.send('show my last order', source);
      expect(view.agent.inputs.at(-1)).toMatchObject({
        type: 'utterance',
        source,
      });

      expect(view.text()).toBe('Working on it…');

      act(() => {
        view.agent.emit(agentPlaceholderEvent(inputId, 'Looking it up'));
      });
      expect(view.text()).toBe('Looking it up');
      expect(view.reply()?.dataset['status']).toBe('working');

      act(() => {
        view.agent.emit(agentAcceptedEvent(inputId, RUN));
        view.agent.emit(agentMessageEvent(RUN, 'Your last '));
      });
      expect(view.text()).toBe('Your last ');
      expect(view.reply()?.getAttribute('aria-live')).toBe('polite');

      act(() => {
        view.agent.emit(agentMessageEvent(RUN, 'order is ORD-10455'));
      });
      expect(view.text()).toBe('Your last order is ORD-10455');

      act(() => {
        view.agent.emit(
          agentFinishedEvent(RUN, { reply: 'Your last order is ORD-10455.' }),
        );
      });
      expect(view.text()).toBe('Your last order is ORD-10455.');
      expect(view.reply()?.dataset['status']).toBe('finished');
    },
  );

  it('shows a planner-only reply that arrives as one delta plus the finished reply', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my orders', 'text');

    act(() => {
      view.agent.emit(agentPlaceholderEvent(inputId, 'Planning'));
      view.agent.emit(agentAcceptedEvent(inputId, RUN, 'ui_only'));
    });
    expect(view.text()).toBe('Planning');

    act(() => {
      view.agent.emit(agentMessageEvent(RUN, 'Here are your'));
    });
    expect(view.text()).toBe('Here are your');

    act(() => {
      view.agent.emit(
        agentFinishedEvent(RUN, { reply: 'Here are your three orders.' }),
      );
    });
    expect(view.text()).toBe('Here are your three orders.');
    expect(view.reply()?.dataset['status']).toBe('finished');
  });

  it('renders nothing for a run that finishes with an empty reply', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my orders', 'text');
    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN, 'ui_only'));
    });
    expect(view.text()).toBe('Working on it…');

    act(() => {
      view.agent.emit(agentFinishedEvent(RUN, { reply: '' }));
    });

    expect(view.reply()).toBeNull();
  });

  it.each([
    ['a', 'Done.', 'The page could not be fully updated. Done.'],
    ['an empty', '', 'The page could not be fully updated.'],
  ])(
    'puts a fixed one-line notice before %s reply when a UI change fails',
    async (_label, finalReply, expected) => {
      const view = await renderReply();
      const inputId = await view.send('show my last order', 'text');
      act(() => {
        view.agent.emit(agentAcceptedEvent(inputId, RUN));
        view.agent.emit(agentFinishedEvent(RUN, { reply: finalReply }));
        view.agent.emit(
          agentErrorEvent({
            runId: RUN,
            changeId: ChangeId('change-1'),
            error: 'Vessel orders rejected the layout',
          }),
        );
      });

      expect(view.text()).toBe(expected);
      expect(view.reply()?.dataset['status']).toBe('finished');
      expect(view.reply()?.hasAttribute('data-change-error')).toBe(true);
      expect(view.reply()?.querySelectorAll('p')).toHaveLength(1);
    },
  );

  it('shows a dropped connection as a lost conversation', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my last order', 'text');
    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(agentMessageEvent(RUN, 'Your last'));
    });

    act(() => {
      view.agent.close({ clean: false });
    });

    expect(view.reply()?.dataset['status']).toBe('lost');
    expect(view.text()).toBe(DROPPED_COPY);
  });

  it('shows a replaced connector as a lost conversation', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my last order', 'voice');
    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
    });

    view.replaceConnector(createMockAgentConnector().connector);

    await waitFor(() => {
      expect(view.reply()?.dataset['status']).toBe('lost');
    });
    expect(view.text()).toBe(DROPPED_COPY);
  });

  it('shows a silent run as possibly recovering, then the reply when it resumes', async () => {
    const view = await renderReply();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const inputId = await view.send('show my last order', 'text');
    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
    });

    act(() => {
      vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS);
    });
    expect(view.reply()?.dataset['status']).toBe('lost');
    expect(view.text()).toBe(STALE_COPY);

    act(() => {
      view.agent.emit(agentMessageEvent(RUN, 'Found it'));
    });
    expect(view.text()).toBe('Found it');
  });

  it('shows an error notice when the run fails', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my last order', 'text');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(
        agentFinishedEvent(RUN, {
          ok: false,
          reason: 'error',
          reply: undefined,
          error: 'Model unavailable',
        }),
      );
    });

    expect(view.reply()?.dataset['status']).toBe('failed');
    expect(view.text()).toBe('Something went wrong: Model unavailable');
  });

  it('falls back to the finish reason when a failed run carries no error text', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my last order', 'text');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(
        agentFinishedEvent(RUN, {
          ok: false,
          reason: 'budget',
          reply: undefined,
        }),
      );
    });

    expect(view.reply()?.dataset['status']).toBe('failed');
    expect(view.text()).toBe('Something went wrong: budget');
  });

  it('shows an error notice when the input is rejected', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my last order', 'voice');

    act(() => {
      view.agent.emit(agentErrorEvent({ inputId, error: 'Too many requests' }));
    });

    expect(view.text()).toBe('Something went wrong: Too many requests');
  });

  it('shows an error notice for a failure tied to no input', async () => {
    const view = await renderReply();

    act(() => {
      view.agent.emit(agentErrorEvent({ error: 'Agent unavailable' }));
    });

    expect(view.reply()?.dataset['status']).toBe('failed');
    expect(view.text()).toBe('Something went wrong: Agent unavailable');
  });

  it('replaces a failure tied to no input with a later voice run', async () => {
    const view = await renderReply();
    act(() => {
      view.agent.emit(agentErrorEvent({ error: 'Unknown change' }));
    });
    expect(view.text()).toBe('Something went wrong: Unknown change');

    const voiceInput = MessageId('voice-input-1');
    act(() => {
      view.agent.emit(agentPlaceholderEvent(voiceInput, 'Looking it up'));
    });
    expect(view.reply()?.dataset['status']).toBe('working');
    expect(view.text()).toBe('Looking it up');

    act(() => {
      view.agent.emit(agentAcceptedEvent(voiceInput, RUN));
      view.agent.emit(
        agentFinishedEvent(RUN, { reply: 'Your last order is ORD-10455.' }),
      );
    });
    expect(view.reply()?.dataset['status']).toBe('finished');
    expect(view.text()).toBe('Your last order is ORD-10455.');
  });

  it('prefers a later failure tied to no input over the finished reply', async () => {
    const view = await renderReply();
    const inputId = await view.send('show my last order', 'text');
    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(agentFinishedEvent(RUN, { reply: 'Done.' }));
    });

    act(() => {
      view.agent.emit(agentErrorEvent({ error: 'Agent unavailable' }));
    });

    expect(view.text()).toBe('Something went wrong: Agent unavailable');
  });
});

const DROPPED_COPY =
  'Conversation lost. The connection dropped, so please ask again.';
const STALE_COPY =
  'Conversation lost. The assistant went quiet and may still answer.';

async function renderReply(agent: MockAgentConnector = createAgent()) {
  let sendMessage: ReturnType<typeof m.useAgentRun>['sendMessage'] | null =
    null;

  function SendProbe() {
    sendMessage = m.useAgentRun().sendMessage;
    const connectionStatus = m.useMaelstrom((state) => state.connectionStatus);
    return <span data-testid="connection" data-status={connectionStatus} />;
  }

  function Harness({ connector }: { connector: EngineConnector }) {
    return (
      <m.Provider connector={connector}>
        <SendProbe />
        <ShopAgentReply />
      </m.Provider>
    );
  }

  const view = render(<Harness connector={agent.connector} />);
  await waitFor(() => {
    expect(view.getByTestId('connection').dataset['status']).toBe('connected');
  });

  const reply = () =>
    view.container.querySelector<HTMLElement>(
      '[data-testid="shop-agent-reply"]',
    );

  return {
    agent,
    reply,
    text: () => reply()?.textContent ?? null,
    replaceConnector(connector: EngineConnector) {
      view.rerender(<Harness connector={connector} />);
    },
    async send(text: string, source: 'text' | 'voice' = 'text') {
      let inputId: MessageId | undefined;
      await act(async () => {
        if (sendMessage === null) throw new Error('expected sendMessage');
        inputId = await sendMessage(text, { source });
      });
      if (inputId === undefined) throw new Error('expected an input id');
      return inputId;
    },
  };
}

function createAgent(): MockAgentConnector {
  return createMockAgentConnector({
    process: async (message) => ({
      type: 'maelstrom_response',
      requestId: message.id,
      userMessage: '',
      rationale: '',
      executionPlan: [],
      layout: { type: 'grid', positions: [] },
    }),
  });
}
