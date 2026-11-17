import { afterEach, describe, expect, it } from 'bun:test';

import {
  AgentWireUnsupportedError,
  type MessageId,
  type SettledAgentRun,
} from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
  type MockAgentConnector,
} from '@maelstrom-co/client/_testing';
import { ChangeId, RunId } from '@maelstrom-co/protocol';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { assertDefined } from './__tests__/assert-defined.js';
import { createMockAgentEngineConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

const entry = vessel(testVessel, () => null);
const RUN = RunId('run-1');

afterEach(() => cleanup());

describe('m.useAgentRun()', () => {
  it('renders the placeholder, then the streamed reply, then the finished reply', async () => {
    const view = await renderAgentRun();

    const inputId = await view.send('show my last order');
    expect(view.text()).toBe('pending||');

    act(() => {
      view.agent.emit(agentPlaceholderEvent(inputId, 'Looking it up'));
    });
    expect(view.text()).toBe('pending|Looking it up|');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(agentMessageEvent(RUN, 'Your last '));
    });
    expect(view.text()).toBe('streaming|Looking it up|Your last ');

    act(() => {
      view.agent.emit(agentMessageEvent(RUN, 'order is ORD-10455'));
    });
    expect(view.text()).toBe(
      'streaming|Looking it up|Your last order is ORD-10455',
    );

    act(() => {
      view.agent.emit(
        agentFinishedEvent(RUN, { reply: 'Your last order is ORD-10455.' }),
      );
    });
    expect(view.text()).toBe(
      'finished|Looking it up|Your last order is ORD-10455.',
    );
    expect(view.latest().run).toMatchObject({
      status: 'finished',
      ack: 'On it',
      outcome: { reason: 'completed' },
    });
  });

  it('shows the run lost after the transport disconnects', async () => {
    const view = await renderAgentRun();
    const inputId = await view.send('show my last order');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(agentMessageEvent(RUN, 'Your last'));
    });
    act(() => {
      view.agent.close({ clean: true });
    });

    expect(view.text()).toBe('lost||Your last');
    expect(view.latest().run).toMatchObject({ lostReason: 'disconnected' });
  });

  it('shows the run failed with the message after an error for its input', async () => {
    const view = await renderAgentRun();
    const inputId = await view.send('show my last order');

    act(() => {
      view.agent.emit(
        agentErrorEvent({
          inputId,
          error: 'Too many requests',
          code: 'rate_limited',
        }),
      );
    });

    expect(view.text()).toBe('failed||');
    expect(view.latest().run).toMatchObject({
      error: { message: 'Too many requests', code: 'rate_limited' },
    });
  });

  it('shows the run failed with the message after a failed finish', async () => {
    const view = await renderAgentRun();
    const inputId = await view.send('show my last order');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(
        agentFinishedEvent(RUN, {
          ok: false,
          reason: 'error',
          reply: undefined,
          error: 'Model unavailable',
          code: 'model_error',
        }),
      );
    });

    expect(view.text()).toBe('failed||');
    expect(view.latest().run).toMatchObject({
      error: { message: 'Model unavailable', code: 'model_error' },
    });
  });

  it('keeps a run open and records a run-scoped error as a failed UI change', async () => {
    const view = await renderAgentRun();
    const inputId = await view.send('show my last order');
    const changeId = ChangeId('change-1');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, RUN));
      view.agent.emit(
        agentErrorEvent({ runId: RUN, changeId, error: 'Planner failed' }),
      );
    });

    expect(view.text()).toBe('working||');
    const run = view.latest().run;
    assertDefined(run);
    expect(run).not.toHaveProperty('error');
    expect(run.changeErrors).toEqual([{ changeId, message: 'Planner failed' }]);
  });

  it('settles a noise input as ignored with no run', async () => {
    const view = await renderAgentRun();
    const inputId = await view.send('uh');

    act(() => {
      view.agent.emit(agentAcceptedEvent(inputId, null));
    });

    expect(view.text()).toBe('ignored||');
    expect(view.latest().run).toMatchObject({
      runId: null,
      disposition: 'noise',
    });
  });

  it('exposes a failure tied to no input or run and clears it on the next send', async () => {
    const view = await renderAgentRun();

    act(() => {
      view.agent.emit(agentErrorEvent({ error: 'Agent unavailable' }));
    });
    expect(view.latest().error).toEqual({ message: 'Agent unavailable' });
    expect(view.latest().run).toBeNull();

    await view.send('show my last order');

    expect(view.latest().error).toBeNull();
  });

  it('lists every run oldest first and exposes the latest as run', async () => {
    const view = await renderAgentRun();

    const first = await view.send('show my last order');
    const second = await view.send('show the one before');

    const { run, runs } = view.latest();
    expect(runs.map((registered) => registered.inputId)).toEqual([
      first,
      second,
    ]);
    expect(run?.inputId).toBe(second);
  });

  it('sends the text with its source under the input id the agent saw', async () => {
    const view = await renderAgentRun();

    const inputId = await view.send('show my last order', 'voice');

    const utterance = view.agent.inputs.find(
      (input) => input.type === 'utterance',
    );
    expect(utterance?.inputId).toBe(inputId);
    expect(utterance?.text).toBe('show my last order');
    expect(utterance?.source).toBe('voice');
  });

  it('keeps sendMessage identity across renders and snapshot changes', async () => {
    const view = await renderAgentRun();
    const initial = view.latest().sendMessage;

    act(() => {
      view.rerender();
    });
    expect(view.latest().sendMessage).toBe(initial);

    const inputId = await view.send('show my last order');
    act(() => {
      view.agent.emit(agentPlaceholderEvent(inputId, 'Looking it up'));
    });

    expect(view.renders()).toBeGreaterThan(2);
    expect(view.latest().sendMessage).toBe(initial);
  });

  it('shows not_submitted and settles the result when the connector cannot carry agent inputs', async () => {
    const unsupported = new AgentWireUnsupportedError(
      'This connector cannot carry agent inputs',
    );
    const view = await renderAgentRun(
      createMockAgentEngineConnector({
        sendInput: () => Promise.reject(unsupported),
      }),
    );

    let settled: SettledAgentRun | undefined;
    await act(async () => {
      settled = await view.latest().sendMessage('show my last order').result;
    });

    expect(settled).toMatchObject({
      status: 'not_submitted',
      error: { message: 'This connector cannot carry agent inputs' },
    });
    expect(view.text()).toBe('not_submitted||');
  });

  it('throws outside a Provider', () => {
    const m = createMaelstrom({ vessels: [entry] });

    function Orphan() {
      m.useAgentRun();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      'must be used within a <Provider>',
    );
  });
});

async function renderAgentRun(
  agent: MockAgentConnector = createMockAgentEngineConnector(),
) {
  const m = createMaelstrom({ vessels: [entry] });
  let latest: ReturnType<typeof m.useAgentRun> | null = null;
  let renders = 0;
  let forceRender: (() => void) | null = null;

  function AgentRunView() {
    const [, setTick] = useState(0);
    forceRender = () => setTick((tick) => tick + 1);
    const result = m.useAgentRun();
    const connectionStatus = m.useMaelstrom((state) => state.connectionStatus);
    latest = result;
    renders++;
    const run = result.run;
    return (
      <output data-connection={connectionStatus}>
        {run === null
          ? 'none'
          : `${run.status}|${run.placeholder ?? ''}|${run.reply}`}
      </output>
    );
  }

  const view = render(
    <m.Provider connector={agent.connector}>
      <AgentRunView />
    </m.Provider>,
  );
  await waitFor(() => {
    expect(view.getByRole('status').dataset['connection']).toBe('connected');
  });

  const current = () => {
    assertDefined(latest);
    return latest;
  };

  return {
    agent,
    latest: current,
    renders: () => renders,
    text: () => view.getByRole('status').textContent,
    rerender: () => {
      assertDefined(forceRender);
      forceRender();
    },
    async send(text: string, source?: 'text' | 'voice'): Promise<MessageId> {
      let inputId: MessageId | undefined;
      await act(async () => {
        inputId = current().sendMessage(
          text,
          source === undefined ? undefined : { source },
        ).inputId;
        await view.findByRole('status');
      });
      assertDefined(inputId);
      return inputId;
    },
  };
}
