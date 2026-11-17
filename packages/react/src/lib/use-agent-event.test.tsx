import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import type {
  AgentConversationEvents,
  MessageId,
  Orchestrator,
} from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentErrorEvent,
  agentFinishedEvent,
  agentMessageEvent,
  agentPlaceholderEvent,
  agentUiChangeEvent,
} from '@maelstrom-co/client/_testing';
import {
  ChangeId,
  type MaelstromResponse,
  MessageId as toMessageId,
  RunId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  type ReactNode,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
  useState,
} from 'react';

import { assertDefined } from './__tests__/assert-defined.js';
import { createMockAgentEngineConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

const entry = vessel(testVessel, () => null);
const RUN = RunId('run-1');
const CHANGE = ChangeId('change-1');

afterEach(() => cleanup());

describe('m.useAgentEvent()', () => {
  it('delivers placeholder, accepted, message and finished payloads to their handlers', async () => {
    const onPlaceholder = mock();
    const onAccepted = mock();
    const onMessage = mock();
    const onFinished = mock();
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        m.useAgentEvent('placeholder', onPlaceholder);
        m.useAgentEvent('accepted', onAccepted);
        m.useAgentEvent('message', onMessage);
        m.useAgentEvent('finished', onFinished);
        return null;
      }
      return <Listener />;
    });

    const inputId = await harness.send('show my last order');
    const placeholder = agentPlaceholderEvent(inputId, 'Looking it up');
    const message = agentMessageEvent(RUN, 'Your last order');
    const finished = agentFinishedEvent(RUN, { reply: 'Your last order.' });
    act(() => {
      harness.agent.emit(placeholder);
      harness.agent.emit(agentAcceptedEvent(inputId, RUN));
      harness.agent.emit(message);
      harness.agent.emit(finished);
    });

    expect(onPlaceholder).toHaveBeenCalledTimes(1);
    expect(onPlaceholder).toHaveBeenCalledWith(placeholder);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith({
      type: 'accepted',
      inputId,
      runId: RUN,
      disposition: 'agent',
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(message);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(finished);
  });

  it('delivers a ui_change payload once the Orchestrator applied the change', async () => {
    const onUiChange = mock();
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        m.useAgentEvent('ui_change', onUiChange);
        return null;
      }
      return <Listener />;
    });

    const inputId = await harness.send('show my last order');
    const applied = harness.agent.nextInput('ui_applied');
    act(() => {
      harness.agent.emit(agentAcceptedEvent(inputId, RUN));
      harness.agent.emit(agentUiChangeEvent(RUN, CHANGE, emptyResponse()));
    });
    await act(async () => {
      await applied;
    });

    await waitFor(() => {
      expect(onUiChange).toHaveBeenCalledTimes(1);
    });
    expect(onUiChange).toHaveBeenCalledWith({
      type: 'ui_change',
      runId: RUN,
      changeId: CHANGE,
      actionOutcomes: [],
    });
  });

  it('delivers error payloads', async () => {
    const onError = mock();
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        m.useAgentEvent('error', onError);
        return null;
      }
      return <Listener />;
    });

    const inputId = await harness.send('show my last order');
    const inputError = agentErrorEvent({
      inputId,
      error: 'Too many requests',
      code: 'rate_limited',
    });
    const changeError = agentErrorEvent({
      runId: RUN,
      changeId: CHANGE,
      error: 'Planner failed',
    });
    act(() => {
      harness.agent.emit(inputError);
      harness.agent.emit(changeError);
    });

    expect(onError.mock.calls).toEqual([[inputError], [changeError]]);
  });

  it('delivers conversation_lost payloads', async () => {
    const onLost = mock();
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        m.useAgentEvent('conversation_lost', onLost);
        return null;
      }
      return <Listener />;
    });

    await harness.send('show my last order');
    act(() => {
      harness.agent.close({ clean: true });
    });

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledWith({
      type: 'conversation_lost',
      reason: 'disconnected',
    });
  });

  it('routes a rejected async handler to the emitter error log', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boom = new Error('boom');
      const rejection = Promise.reject(boom);
      rejection.catch(() => {});
      const harness = await renderWithAgent(({ m }) => {
        function Listener() {
          m.useAgentEvent('placeholder', () => rejection);
          return null;
        }
        return <Listener />;
      });

      act(() => {
        harness.agent.emit(
          agentPlaceholderEvent(toMessageId('input-1'), 'one'),
        );
      });

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Error in async placeholder listener:',
          boom,
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('calls the newest handler without resubscribing when the handler changes', async () => {
    const calls: string[] = [];
    let setVersion: ((version: number) => void) | null = null;
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        const [version, setState] = useState(1);
        setVersion = setState;
        m.useAgentEvent('placeholder', (event) => {
          calls.push(`v${version}:${event.text}`);
        });
        return null;
      }
      return <Listener />;
    });
    const subscriptionsAfterMount = harness.subscriptions('placeholder');

    act(() => {
      assertDefined(setVersion);
      setVersion(2);
    });
    act(() => {
      harness.agent.emit(agentPlaceholderEvent(toMessageId('input-1'), 'one'));
    });

    expect(harness.subscriptions('placeholder')).toBe(subscriptionsAfterMount);
    expect(calls).toEqual(['v2:one']);
  });

  it('keeps calling the committed handler while a transition that changes the handler is suspended', async () => {
    const calls: string[] = [];
    const neverResolves = new Promise<never>(() => {});
    let setVersion: ((version: number) => void) | null = null;
    const harness = await renderWithAgent(({ m }) => {
      function Listener({ version }: { version: number }) {
        m.useAgentEvent('placeholder', (event) => {
          calls.push(`v${version}:${event.text}`);
        });
        return null;
      }
      function Suspender({ version }: { version: number }) {
        if (version === 2) {
          throw neverResolves;
        }
        return null;
      }
      function Parent() {
        const [version, setState] = useState(1);
        setVersion = setState;
        return (
          <Suspense fallback={null}>
            <Listener version={version} />
            <Suspender version={version} />
          </Suspense>
        );
      }
      return <Parent />;
    });

    act(() => {
      startTransition(() => {
        assertDefined(setVersion);
        setVersion(2);
      });
    });
    act(() => {
      harness.agent.emit(agentPlaceholderEvent(toMessageId('input-1'), 'one'));
    });

    expect(calls).toEqual(['v1:one']);
  });

  it('moves the subscription to the new event type when the type changes', async () => {
    const received: string[] = [];
    let setType: ((type: 'placeholder' | 'message') => void) | null = null;
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        const [type, setState] = useState<'placeholder' | 'message'>(
          'placeholder',
        );
        setType = setState;
        m.useAgentEvent(type, (event) => {
          received.push(event.type);
        });
        return null;
      }
      return <Listener />;
    });
    const messageSubscriptionsBefore = harness.subscriptions('message');

    act(() => {
      assertDefined(setType);
      setType('message');
    });
    act(() => {
      harness.agent.emit(agentPlaceholderEvent(toMessageId('input-1'), 'one'));
      harness.agent.emit(agentMessageEvent(RUN, 'Your last order'));
    });

    expect(harness.subscriptions('message')).toBe(
      messageSubscriptionsBefore + 1,
    );
    expect(received).toEqual(['message']);
  });

  it('does not deliver an old-type event to the new handler before the old subscription is cleaned up', async () => {
    const received: string[] = [];
    let setType: ((type: 'placeholder' | 'message') => void) | null = null;
    let emitter: Awaited<ReturnType<typeof renderWithAgent>>['agent'] | null =
      null;
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        const [type, setState] = useState<'placeholder' | 'message'>(
          'placeholder',
        );
        setType = setState;
        m.useAgentEvent(type, (event) => {
          received.push(event.type);
        });
        useLayoutEffect(() => {
          if (type === 'message') {
            assertDefined(emitter);
            emitter.emit(agentPlaceholderEvent(toMessageId('input-1'), 'one'));
          }
        }, [type]);
        return null;
      }
      return <Listener />;
    });
    emitter = harness.agent;

    act(() => {
      assertDefined(setType);
      setType('message');
    });

    expect(received).toEqual([]);
  });

  it('stops calling the handler after the component unmounts', async () => {
    const onPlaceholder = mock();
    let setMounted: ((mounted: boolean) => void) | null = null;
    const harness = await renderWithAgent(({ m }) => {
      function Listener() {
        m.useAgentEvent('placeholder', onPlaceholder);
        return null;
      }
      function Toggle() {
        const [mounted, setState] = useState(true);
        setMounted = setState;
        return mounted ? <Listener /> : null;
      }
      return <Toggle />;
    });
    act(() => {
      assertDefined(setMounted);
      setMounted(false);
    });
    act(() => {
      harness.agent.emit(agentPlaceholderEvent(toMessageId('input-1'), 'late'));
    });

    expect(onPlaceholder).not.toHaveBeenCalled();
  });

  it('unmounts together with its Provider while the Orchestrator is disposed, without throwing or logging', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const harness = await renderWithAgent(({ m }) => {
        function Listener() {
          m.useAgentEvent('placeholder', () => {});
          m.useAgentEvent('conversation_lost', () => {});
          return null;
        }
        return <Listener />;
      });

      expect(() => harness.unmount()).not.toThrow();
      expect(harness.disposalStarted()).toBe(true);
      await act(async () => {
        await harness.disposal();
      });

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('calls the handler once per event under Strict Mode', async () => {
    const onPlaceholder = mock();
    const harness = await renderWithAgent(
      ({ m }) => {
        function Listener() {
          m.useAgentEvent('placeholder', onPlaceholder);
          return null;
        }
        return <Listener />;
      },
      { strict: true },
    );

    act(() => {
      harness.agent.emit(agentPlaceholderEvent(toMessageId('input-1'), 'one'));
    });

    expect(onPlaceholder).toHaveBeenCalledTimes(1);
  });

  it('throws outside a Provider', () => {
    const m = createMaelstrom({ vessels: [entry] });

    function Orphan() {
      m.useAgentEvent('message', () => {});
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      'must be used within a <Provider>',
    );
  });
});

type AgentEventType = keyof AgentConversationEvents;

type TrackedOrchestrator = {
  orchestrator: Orchestrator;
  subscriptions: Map<AgentEventType, number>;
  disposal: Promise<void> | null;
};

async function renderWithAgent(
  children: (context: { m: ReturnType<typeof createInstance> }) => ReactNode,
  options: { strict?: boolean } = {},
) {
  const agent = createMockAgentEngineConnector();
  const tracked: TrackedOrchestrator[] = [];
  const m = createInstance(tracked);

  function ConnectionProbe() {
    const connectionStatus = m.useMaelstrom((state) => state.connectionStatus);
    return <output data-connection={connectionStatus} />;
  }

  const tree = (
    <m.Provider connector={agent.connector}>
      <ConnectionProbe />
      {children({ m })}
    </m.Provider>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  await waitFor(() => {
    expect(view.getByRole('status').dataset['connection']).toBe('connected');
  });

  const live = (): TrackedOrchestrator => {
    const current = tracked[tracked.length - 1];
    assertDefined(current);
    return current;
  };

  return {
    agent,
    unmount: () => view.unmount(),
    subscriptions: (type: AgentEventType) =>
      live().subscriptions.get(type) ?? 0,
    disposalStarted: () =>
      tracked.length > 0 && tracked.every((record) => record.disposal !== null),
    disposal: () =>
      Promise.all(tracked.map((record) => record.disposal)).then(
        () => undefined,
      ),
    async send(text: string): Promise<MessageId> {
      let inputId: MessageId | undefined;
      await act(async () => {
        inputId = await live().orchestrator.sendMessage(text);
      });
      assertDefined(inputId);
      return inputId;
    },
  };
}

function createInstance(tracked: TrackedOrchestrator[] = []) {
  return createMaelstrom({ vessels: [entry] }).with((context) => {
    context.onOrchestrator?.((orchestrator) => {
      const record: TrackedOrchestrator = {
        orchestrator,
        subscriptions: new Map(),
        disposal: null,
      };
      tracked.push(record);
      const events = orchestrator.agent;
      const on = events.on.bind(events);
      events.on = (type, listener) => {
        record.subscriptions.set(
          type,
          (record.subscriptions.get(type) ?? 0) + 1,
        );
        return on(type, listener);
      };
      const dispose = orchestrator.dispose.bind(orchestrator);
      orchestrator.dispose = () => {
        record.disposal ??= dispose();
        return record.disposal;
      };
      return () => {};
    });
    return {};
  });
}

function emptyResponse(): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: toMessageId('response-change-1'),
    userMessage: '',
    rationale: 'agent change',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}
