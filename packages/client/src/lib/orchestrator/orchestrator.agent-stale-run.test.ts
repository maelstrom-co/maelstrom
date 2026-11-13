import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  type ActionExecution,
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentAcceptedEvent,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentFinishedEvent,
  type AgentMessageEvent,
  type AgentPlaceholderEvent,
  type AgentStartedEvent,
  type AgentToolCallEvent,
  type AgentToolResultEvent,
  type AgentUiChangeEvent,
  CallId,
  ChangeId,
  InstanceId,
  MessageId,
  ok,
  RunId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import {
  createMockAgentConnector,
  type MockAgentConnector,
} from '../../../test-utils/agent-connector-mock.js';
import type { EngineConnector } from '../connection-manager/connector.types.js';
import type {
  AgentConversationEvents,
  ConversationLostEvent,
} from './conversation-event.types.js';
import { Orchestrator } from './orchestrator.js';
import type { OrchestratorOptions } from './orchestrator.types.js';

const boardVessel = {
  id: 'board',
  name: 'Board',
  description: 'a board the agent arranges',
  defaultVariant: 'collapsed',
  variants: {
    collapsed: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'record', description: 'a slow piece of work' }],
    },
  },
} as const;

const mainBoard = InstanceId('board-main');
const defaultStaleWindowMs = 150_000;
const justUnderWindowMs = defaultStaleWindowMs - 1;
const farPastWindowMs = defaultStaleWindowMs * 10;
// Below the Orchestrator's fixed 30 s Action execution timeout, so an Action
// can outlast the window and still succeed.
const shortStaleWindowMs = 10_000;
const runA = RunId('run-a');
const runB = RunId('run-b');

describe('Orchestrator agent stale run safety net', () => {
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
      ],
    });
  });

  afterEach(() => {
    clock.uninstall();
  });

  it('reports the input as stale when an utterance gets no event within the default window', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputId = await orchestrator.sendUtterance('show the board');

      await clock.tickAsync(justUnderWindowMs);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', inputId },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('restarts the input window on a placeholder for that input', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputId = await orchestrator.sendUtterance('show the board');

      await clock.tickAsync(justUnderWindowMs);
      agent.emit(placeholderEvent(inputId));
      await clock.tickAsync(justUnderWindowMs);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', inputId },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('keeps a run alive while started, tool and message events arrive just inside the window, then finished ends it', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputId = await orchestrator.sendUtterance('show the board');

      const steadyEvents = [
        acceptedEvent(inputId, runA),
        startedEvent(runA),
        toolCallEvent(runA),
        toolResultEvent(runA),
        messageEvent(runA, 'Looking'),
        messageEvent(runA, ' at it'),
        finishedEvent(runA),
      ];
      for (const event of steadyEvents) {
        await clock.tickAsync(justUnderWindowMs);
        agent.emit(event);
      }
      await clock.tickAsync(farPastWindowMs);

      expect(losses).toEqual([]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('names the run once accepted, starting its window fresh at accepted', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputId = await orchestrator.sendUtterance('show the board');

      await clock.tickAsync(100_000);
      agent.emit(acceptedEvent(inputId, runA));
      await clock.tickAsync(justUnderWindowMs);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', runId: runA },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('still delivers events of a run reported stale but arms no new timer for it', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const messages: AgentConversationEvents['message'][] = [];
      orchestrator.agent.on('message', (event) => messages.push(event));
      const inputId = await orchestrator.sendUtterance('show the board');
      agent.emit(acceptedEvent(inputId, runA));
      await clock.tickAsync(defaultStaleWindowMs);
      expect(losses).toHaveLength(1);

      const late = messageEvent(runA, 'late reply');
      agent.emit(late);
      await clock.tickAsync(farPastWindowMs);

      expect(messages).toEqual([late]);
      expect(losses).toHaveLength(1);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('leaves no timer for an input accepted as noise with a null runId', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputId = await orchestrator.sendUtterance('um');

      agent.emit(acceptedEvent(inputId, null));
      await clock.tickAsync(farPastWindowMs);

      expect(losses).toEqual([]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('leaves no timer for an input the agent answered with an error', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputId = await orchestrator.sendUtterance('show the board');

      agent.emit(errorEvent(inputId));
      await clock.tickAsync(farPastWindowMs);

      expect(losses).toEqual([]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('does not count a slow client Action as server silence, then times the run from the ui_applied it sent', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector, {
      agentRunStaleTimeoutMs: shortStaleWindowMs,
    });
    try {
      const losses = recordConversationLosses(orchestrator);
      let lossesWhileActionRan: ConversationLostEvent[] | undefined;
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: async () => {
          await clock.tickAsync(shortStaleWindowMs * 2);
          lossesWhileActionRan = [...losses];
          return ok(undefined);
        },
      });
      const inputId = await orchestrator.sendUtterance('show the board');
      agent.emit(acceptedEvent(inputId, runA));
      agent.emit(startedEvent(runA));

      const applied = agent.nextInput('ui_applied');
      agent.emit(uiChangeEvent(runA, 'change-slow', [step(mainBoard)]));
      const acknowledgement = await applied;

      expect(acknowledgement.actionOutcomes).toEqual([{ ok: true }]);
      expect(lossesWhileActionRan).toEqual([]);
      expect(losses).toEqual([]);

      await clock.tickAsync(shortStaleWindowMs - 1);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', runId: runA },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('keeps a run queued behind another alive on the other run events, then times it from the last event on the stream', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const inputA = await orchestrator.sendUtterance('first');
      agent.emit(acceptedEvent(inputA, runA));
      agent.emit(startedEvent(runA));
      const inputB = await orchestrator.sendUtterance('second');
      agent.emit(acceptedEvent(inputB, runB));

      for (const delta of ['one', 'two', 'three']) {
        await clock.tickAsync(justUnderWindowMs);
        agent.emit(messageEvent(runA, delta));
      }
      await clock.tickAsync(justUnderWindowMs);
      agent.emit(finishedEvent(runA));
      expect(losses).toEqual([]);

      await clock.tickAsync(justUnderWindowMs);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', runId: runB },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('does not count a slow client Action as silence for a run queued behind it, then times the queued run from the ui_applied', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector, {
      agentRunStaleTimeoutMs: shortStaleWindowMs,
    });
    try {
      const losses = recordConversationLosses(orchestrator);
      let lossesWhileActionRan: ConversationLostEvent[] | undefined;
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: async () => {
          await clock.tickAsync(shortStaleWindowMs * 2);
          lossesWhileActionRan = [...losses];
          return ok(undefined);
        },
      });
      const inputA = await orchestrator.sendUtterance('first');
      agent.emit(acceptedEvent(inputA, runA));
      agent.emit(startedEvent(runA));
      const inputB = await orchestrator.sendUtterance('second');
      agent.emit(acceptedEvent(inputB, runB));

      const applied = agent.nextInput('ui_applied');
      agent.emit(uiChangeEvent(runA, 'change-slow', [step(mainBoard)]));
      await applied;

      expect(lossesWhileActionRan).toEqual([]);
      expect(losses).toEqual([]);

      agent.emit(finishedEvent(runA));
      await clock.tickAsync(shortStaleWindowMs - 1);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', runId: runB },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('keeps a queued run paused while a finished run change is still applying, then times it from the ui_applied', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector, {
      agentRunStaleTimeoutMs: shortStaleWindowMs,
    });
    try {
      const losses = recordConversationLosses(orchestrator);
      const release = Promise.withResolvers<void>();
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: async () => {
          await release.promise;
          return ok(undefined);
        },
      });
      const inputA = await orchestrator.sendUtterance('first');
      agent.emit(acceptedEvent(inputA, runA));
      agent.emit(startedEvent(runA));
      const inputB = await orchestrator.sendUtterance('second');
      agent.emit(acceptedEvent(inputB, runB));

      const applied = agent.nextInput('ui_applied');
      agent.emit(uiChangeEvent(runA, 'change-slow', [step(mainBoard)]));
      await clock.tickAsync(0);
      agent.emit(finishedEvent(runA));
      await clock.tickAsync(shortStaleWindowMs * 2);

      expect(losses).toEqual([]);

      release.resolve();
      const acknowledgement = await applied;
      expect(acknowledgement.actionOutcomes).toEqual([{ ok: true }]);

      await clock.tickAsync(shortStaleWindowMs - 1);
      expect(losses).toEqual([]);

      await clock.tickAsync(1);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', runId: runB },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  describe('keeps waiting subjects paused while a change outside any watched run applies', () => {
    it('when the change arrives after its run finished, then times the queued run from the ui_applied', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector, {
        agentRunStaleTimeoutMs: shortStaleWindowMs,
      });
      try {
        const losses = recordConversationLosses(orchestrator);
        const release = Promise.withResolvers<void>();
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: async () => {
            await release.promise;
            return ok(undefined);
          },
        });
        const inputA = await orchestrator.sendUtterance('first');
        agent.emit(acceptedEvent(inputA, runA));
        agent.emit(startedEvent(runA));
        const inputB = await orchestrator.sendUtterance('second');
        agent.emit(acceptedEvent(inputB, runB));
        agent.emit(finishedEvent(runA));

        const applied = agent.nextInput('ui_applied');
        agent.emit(uiChangeEvent(runA, 'change-late', [step(mainBoard)]));
        await clock.tickAsync(shortStaleWindowMs * 2);

        expect(losses).toEqual([]);

        release.resolve();
        await applied;

        await clock.tickAsync(shortStaleWindowMs - 1);
        expect(losses).toEqual([]);

        await clock.tickAsync(1);
        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'stale_run', runId: runB },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('when the change names no run, then times the waiting input from the ui_applied', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector, {
        agentRunStaleTimeoutMs: shortStaleWindowMs,
      });
      try {
        const losses = recordConversationLosses(orchestrator);
        const release = Promise.withResolvers<void>();
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: async () => {
            await release.promise;
            return ok(undefined);
          },
        });
        const inputId = await orchestrator.sendUtterance('show the board');

        const applied = agent.nextInput('ui_applied');
        agent.emit(uiChangeEvent(null, 'change-unowned', [step(mainBoard)]));
        await clock.tickAsync(shortStaleWindowMs * 2);

        expect(losses).toEqual([]);

        release.resolve();
        await applied;

        await clock.tickAsync(shortStaleWindowMs - 1);
        expect(losses).toEqual([]);

        await clock.tickAsync(1);
        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'stale_run', inputId },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  describe('reports no loss when the connector delivers the reply before the send resolves', () => {
    it('with accepted, then times the run instead of the input', async () => {
      const agent = createMockAgentConnector();
      replyBeforeSendResolves(agent, (inputId) => acceptedEvent(inputId, runA));
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        await orchestrator.sendUtterance('show the board');
        agent.emit(startedEvent(runA));
        await clock.tickAsync(1000);
        agent.emit(finishedEvent(runA));

        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([]);
        expect(clock.countTimers()).toBe(0);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('with error', async () => {
      const agent = createMockAgentConnector();
      replyBeforeSendResolves(agent, (inputId) => errorEvent(inputId));
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        await orchestrator.sendUtterance('show the board');

        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([]);
        expect(clock.countTimers()).toBe(0);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  it('leaves no timer for an utterance whose send rejects', async () => {
    const agent = createMockAgentConnector();
    agent.connector.sendAgentInput = () =>
      Promise.reject(new Error('transport refused the frame'));
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);

      const timersBefore = clock.countTimers();
      await expect(
        orchestrator.sendUtterance('show the board'),
      ).rejects.toThrow('transport refused the frame');

      expect(clock.countTimers()).toBe(timersBefore);
      await clock.tickAsync(farPastWindowMs);
      expect(losses).toEqual([]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('sends no ui_applied for a change still applying when another run is reported stale', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector, {
      agentRunStaleTimeoutMs: shortStaleWindowMs,
    });
    try {
      const losses = recordConversationLosses(orchestrator);
      let lossesWhileActionRan: ConversationLostEvent[] | undefined;
      let actionFinished = false;
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: async () => {
          await clock.tickAsync(shortStaleWindowMs * 2);
          lossesWhileActionRan = [...losses];
          actionFinished = true;
          return ok(undefined);
        },
      });
      const inputA = await orchestrator.sendUtterance('first');
      agent.emit(acceptedEvent(inputA, runA));
      agent.emit(startedEvent(runA));
      const inputB = await orchestrator.sendUtterance('second');
      agent.emit(acceptedEvent(inputB, runB));
      agent.emit(startedEvent(runB));

      agent.emit(uiChangeEvent(runB, 'change-slow', [step(mainBoard)]));
      await orchestrator.commandProcessor.waitForIdle();
      await clock.tickAsync(0);

      expect(actionFinished).toBe(true);
      expect(lossesWhileActionRan).toEqual([
        { type: 'conversation_lost', reason: 'stale_run', runId: runA },
      ]);
      expect(agent.inputs.map((input) => input.type)).not.toContain(
        'ui_applied',
      );
    } finally {
      await orchestrator.dispose();
    }
  });

  describe('applies and acknowledges a change of a run that already finished', () => {
    it('when the change arrives after finished', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');
        agent.emit(acceptedEvent(inputId, runA));
        agent.emit(startedEvent(runA));
        agent.emit(finishedEvent(runA));

        const applied = agent.nextInput('ui_applied');
        agent.emit(uiChangeEvent(runA, 'change-late', []));
        const acknowledgement = await applied;
        await clock.tickAsync(farPastWindowMs);

        expect(acknowledgement.changeId).toBe(ChangeId('change-late'));
        expect(
          orchestrator.commandProcessor.store.state.instances.has(mainBoard),
        ).toBe(true);
        expect(losses).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('when finished arrives while the change is still applying', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const release = Promise.withResolvers<void>();
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: async () => {
            await release.promise;
            return ok(undefined);
          },
        });
        const inputId = await orchestrator.sendUtterance('show the board');
        agent.emit(acceptedEvent(inputId, runA));
        agent.emit(startedEvent(runA));

        const applied = agent.nextInput('ui_applied');
        agent.emit(uiChangeEvent(runA, 'change-slow', [step(mainBoard)]));
        await clock.tickAsync(0);
        agent.emit(finishedEvent(runA));
        release.resolve();
        const acknowledgement = await applied;
        await clock.tickAsync(farPastWindowMs);

        expect(acknowledgement.changeId).toBe(ChangeId('change-slow'));
        expect(acknowledgement.actionOutcomes).toEqual([{ ok: true }]);
        expect(losses).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  describe('keeps one window for a run a second accepted names again', () => {
    it('reports no loss after the run finished', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const first = await orchestrator.sendUtterance('show the board');
        agent.emit(acceptedEvent(first, runA));
        agent.emit(startedEvent(runA));
        const amend = await orchestrator.sendUtterance('make it bigger');
        agent.emit(acceptedEvent(amend, runA, 'amend'));
        agent.emit(finishedEvent(runA));

        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('leaves no live timer after dispose', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const first = await orchestrator.sendUtterance('show the board');
      agent.emit(acceptedEvent(first, runA));
      agent.emit(startedEvent(runA));
      const amend = await orchestrator.sendUtterance('make it bigger');
      agent.emit(acceptedEvent(amend, runA, 'amend'));

      await orchestrator.dispose();

      expect(clock.countTimers()).toBe(0);
      await clock.tickAsync(farPastWindowMs);
    });
  });

  describe('leaves no live timer', () => {
    it('after finished', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');
        agent.emit(acceptedEvent(inputId, runA));
        agent.emit(finishedEvent(runA));

        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('after dispose', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const inputId = await orchestrator.sendUtterance('show the board');
      agent.emit(acceptedEvent(inputId, runA));
      await orchestrator.sendUtterance('and another');

      await orchestrator.dispose();

      expect(clock.countTimers()).toBe(0);
      await clock.tickAsync(farPastWindowMs);
    });

    it('after setConnector', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');
        oldAgent.emit(acceptedEvent(inputId, runA));
        await orchestrator.sendUtterance('and another');

        orchestrator.setConnector(newAgent.connector);
        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'connector_replaced' },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  describe('reports one loss when a disconnect and a stale timer coincide', () => {
    it('when the stale timer fires first in the same tick', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');
        setTimeout(() => {
          agent.close({ clean: false });
        }, defaultStaleWindowMs);

        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'stale_run', inputId },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('when the disconnect lands just before the window ends', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');
        agent.emit(acceptedEvent(inputId, runA));
        await orchestrator.sendUtterance('and another');

        await clock.tickAsync(justUnderWindowMs);
        agent.close({ clean: false });
        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'disconnected' },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  describe('agentRunStaleTimeoutMs', () => {
    it('never reports a stale run when set to Infinity', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector, {
        agentRunStaleTimeoutMs: Number.POSITIVE_INFINITY,
      });
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');
        await orchestrator.sendUtterance('and another');
        agent.emit(acceptedEvent(inputId, runA));

        await clock.tickAsync(farPastWindowMs);

        expect(losses).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('uses a custom window when one is given', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector, {
        agentRunStaleTimeoutMs: shortStaleWindowMs,
      });
      try {
        const losses = recordConversationLosses(orchestrator);
        const inputId = await orchestrator.sendUtterance('show the board');

        await clock.tickAsync(shortStaleWindowMs - 1);
        expect(losses).toEqual([]);

        await clock.tickAsync(1);
        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'stale_run', inputId },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });
});

async function connectedOrchestrator(
  connector: EngineConnector,
  options: OrchestratorOptions = {},
): Promise<Orchestrator> {
  const orchestrator = new Orchestrator(connector, {
    vessels: [boardVessel],
    ...options,
  } as OrchestratorOptions);
  await orchestrator.commandProcessor.waitForIdle();
  await orchestrator.connect();
  return orchestrator;
}

function replyBeforeSendResolves(
  agent: MockAgentConnector,
  reply: (inputId: MessageId) => AgentEvent,
): void {
  const send = agent.connector.sendAgentInput.bind(agent.connector);
  agent.connector.sendAgentInput = async (input) => {
    if (input.type === 'utterance') agent.emit(reply(input.inputId));
    await send(input);
  };
}

function recordConversationLosses(
  orchestrator: Orchestrator,
): ConversationLostEvent[] {
  const losses: ConversationLostEvent[] = [];
  orchestrator.agent.on('conversation_lost', (event) => losses.push(event));
  return losses;
}

function acceptedEvent(
  inputId: MessageId,
  runId: RunId | null,
  disposition: AgentAcceptedEvent['disposition'] = runId === null
    ? 'noise'
    : 'agent',
): AgentAcceptedEvent {
  return {
    type: 'accepted',
    version: AGENT_WIRE_VERSION,
    inputId,
    runId,
    disposition,
    ack: runId === null ? '' : 'On it',
  };
}

function placeholderEvent(inputId: MessageId): AgentPlaceholderEvent {
  return {
    type: 'placeholder',
    version: AGENT_WIRE_VERSION,
    inputId,
    text: 'working on it',
  };
}

function startedEvent(runId: RunId): AgentStartedEvent {
  return { type: 'started', version: AGENT_WIRE_VERSION, runId };
}

function toolCallEvent(runId: RunId): AgentToolCallEvent {
  return {
    type: 'tool_call',
    version: AGENT_WIRE_VERSION,
    runId,
    turnId: 'turn-1',
    callId: CallId('call-1'),
    name: 'look',
  };
}

function toolResultEvent(runId: RunId): AgentToolResultEvent {
  return {
    type: 'tool_result',
    version: AGENT_WIRE_VERSION,
    runId,
    turnId: 'turn-1',
    callId: CallId('call-1'),
    name: 'look',
    ok: true,
    summary: 'looked',
  };
}

function messageEvent(runId: RunId, delta: string): AgentMessageEvent {
  return {
    type: 'message',
    version: AGENT_WIRE_VERSION,
    runId,
    turnId: 'turn-1',
    delta,
  };
}

function finishedEvent(runId: RunId): AgentFinishedEvent {
  return {
    type: 'finished',
    version: AGENT_WIRE_VERSION,
    runId,
    ok: true,
    reason: 'completed',
    reply: 'Done',
    metrics: {
      turns: 1,
      toolCalls: 0,
      elapsedMs: 5,
      inputTokens: 10,
      outputTokens: 4,
    },
  };
}

function errorEvent(inputId: MessageId): AgentErrorEvent {
  return {
    type: 'error',
    version: AGENT_WIRE_VERSION,
    inputId,
    error: 'something went wrong',
  };
}

function step(instanceId: InstanceId): ActionExecution {
  return { instanceId, action: ActionName('record') };
}

function uiChangeEvent(
  runId: RunId | null,
  changeId: string,
  executionPlan: ActionExecution[],
): AgentUiChangeEvent {
  return {
    type: 'ui_change',
    version: AGENT_WIRE_VERSION,
    runId,
    changeId: ChangeId(changeId),
    response: {
      type: 'maelstrom_response',
      requestId: MessageId(`response-${changeId}`),
      userMessage: '',
      rationale: 'agent change',
      executionPlan,
      layout: boardLayout(),
    },
  };
}

function boardLayout(): TilingLayout {
  return {
    type: 'tiling',
    tree: [tilingLeafToken(mainBoard)],
    instances: [
      {
        instanceId: mainBoard,
        vesselId: VesselId('board'),
        variant: VariantName('collapsed'),
      },
    ],
  };
}
