import { describe, expect, it, mock, spyOn } from 'bun:test';

import {
  type ActionExecution,
  ActionName,
  AGENT_WIRE_VERSION,
  type AgentErrorEvent,
  type AgentEvent,
  type AgentFinishedEvent,
  type AgentMessageEvent,
  type AgentPlaceholderEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  CallId,
  ChangeId,
  err,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
  RunId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { createMockEmptyResponse } from '../../../test-utils/mocks.js';
import {
  agentAcceptedEvent,
  createMockAgentConnector,
  type MockAgentConnector,
} from '../__test-helpers__/agent-connector-mock.js';
import type { ActionResult } from '../command-processor/action-result.js';
import type { EngineConnector } from '../connection-manager/connector.types.js';
import { AgentWireUnsupportedError } from '../connection-manager/connector.types.js';
import { HttpConnector } from '../connection-manager/connectors/http-connector.js';
import type { DiagnosticObservation } from '../diagnostic-channel.js';
import type {
  AgentConversationEvents,
  AgentMessageSubmission,
  ConversationLostEvent,
} from './conversation-event.types.js';
import { Orchestrator } from './orchestrator.js';
import type { OrchestratorOptions } from './orchestrator.types.js';
import { RequestInFlightError } from './request-in-flight-error.js';

const boardVessel = {
  id: 'board',
  name: 'Board',
  description: 'a board the agent arranges',
  defaultVariant: 'collapsed',
  variants: {
    collapsed: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'record', description: 'record what the board looks like' },
        { name: 'step', description: 'one step of work' },
        { name: 'fail', description: 'a step that fails' },
        {
          name: 'expand',
          description: 'expand the board',
          transitionsTo: 'expanded',
        },
      ],
    },
    expanded: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'record', description: 'record what the board looks like' },
      ],
    },
  },
} as const;

const mainBoard = InstanceId('board-main');
const newBoard = InstanceId('board-new');
const slowBoard = InstanceId('board-slow');
const fastBoard = InstanceId('board-fast');
const orphanBoard = InstanceId('board-orphan');

const shortReadyTimeoutMs = 30;

describe('Orchestrator agent path', () => {
  it('never reports busy: back to back utterances and one during an in flight intent all reach the agent', async () => {
    const agent = createMockAgentConnector();
    const intentResponse = Promise.withResolvers<MaelstromResponse>();
    let intentRequestId: MessageId | undefined;
    const connector: EngineConnector = {
      ...agent.connector,
      process: (message) => {
        intentRequestId = message.id;
        return intentResponse.promise;
      },
    };
    const seed = boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]);
    const orchestrator = await connectedOrchestrator(connector, {
      initialLayout: seed,
    });
    try {
      const firstId = orchestrator.sendMessage('show the board').inputId;
      const secondId = orchestrator.sendMessage('and expand it', {
        source: 'voice',
      }).inputId;
      const intent = orchestrator.processIntent('rearrange');
      const duringIntentId = orchestrator.sendMessage('while busy').inputId;

      const utterances = agent.inputs.filter(
        (input) => input.type === 'utterance',
      );
      expect(utterances.map((input) => input.inputId)).toEqual([
        firstId,
        secondId,
        duringIntentId,
      ]);
      expect(new Set([firstId, secondId, duringIntentId]).size).toBe(3);
      expect(utterances.map((input) => input.text)).toEqual([
        'show the board',
        'and expand it',
        'while busy',
      ]);
      expect(utterances.map((input) => input.source)).toEqual([
        'text',
        'voice',
        'text',
      ]);
      for (const utterance of utterances) {
        expect(utterance.version).toBe(AGENT_WIRE_VERSION);
        expect(utterance.chart.type).toBe('chart_request');
        expect(utterance.chart.context.layoutMode).toBe('tiling');
        expect(utterance.chart.context.chartDimensions).toEqual(
          orchestrator.chartManager.store.state.chartDimensions,
        );
        expect(utterance.chart.instances).toEqual([
          {
            instanceId: mainBoard,
            vesselId: VesselId('board'),
            variant: VariantName('collapsed'),
          },
        ]);
        expect(utterance.chart.layout).toEqual(seed);
        expect(utterance.chart.vessels.map((vessel) => vessel.id)).toEqual([
          VesselId('board'),
        ]);
      }

      if (intentRequestId === undefined)
        throw new Error('Expected the intent to reach the connector');
      intentResponse.resolve(createMockEmptyResponse(intentRequestId));
      await intent;
    } finally {
      await orchestrator.dispose();
    }
  });

  it('applies the Layout before running Actions so an Action sees the Instance the same change introduced', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      let layoutSeenByAction: unknown;
      let instanceSeenByAction: unknown;
      orchestrator.commandProcessor.registerRunner(newBoard, {
        record: () => {
          const state = orchestrator.commandProcessor.store.state;
          layoutSeenByAction = state.layout;
          instanceSeenByAction = state.instances.get(newBoard);
          return Promise.resolve<ActionResult>(ok(undefined));
        },
      });
      const layout = boardLayout([
        { instanceId: newBoard, variant: 'collapsed' },
      ]);

      const applied = agent.nextInput('ui_applied');
      agent.emit(
        uiChange('change-layout-first', layout, [step(newBoard, 'record')]),
      );
      const acknowledgement = await applied;

      expect(layoutSeenByAction).toEqual(layout);
      expect(instanceSeenByAction).toMatchObject({
        instanceId: newBoard,
        variant: VariantName('collapsed'),
      });
      expect(acknowledgement.actionOutcomes).toEqual([{ ok: true }]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('reports the Chart as it stands after the Actions ran, including Variant transitions', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        expand: () => Promise.resolve<ActionResult>(ok(undefined)),
      });

      const applied = agent.nextInput('ui_applied');
      agent.emit(
        uiChange(
          'change-expand',
          boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
          [step(mainBoard, 'expand')],
        ),
      );
      const acknowledgement = await applied;

      expect(acknowledgement.actionOutcomes).toEqual([{ ok: true }]);
      expect(acknowledgement.chart.instances).toEqual([
        {
          instanceId: mainBoard,
          vesselId: VesselId('board'),
          variant: VariantName('expanded'),
        },
      ]);
      const chartLayout = acknowledgement.chart.layout;
      if (chartLayout.type !== 'tiling')
        throw new Error('Expected a tiling layout in the Chart');
      expect(chartLayout.instances.map((instance) => instance.variant)).toEqual(
        [VariantName('expanded')],
      );
    } finally {
      await orchestrator.dispose();
    }
  });

  it('reports outcomes in Execution Plan order when Instances finish out of order', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const fastStepDone = Promise.withResolvers<void>();
      const completionOrder: string[] = [];
      orchestrator.commandProcessor.registerRunner(slowBoard, {
        step: async () => {
          await fastStepDone.promise;
          completionOrder.push('slow step');
          return ok(undefined);
        },
        fail: () => {
          completionOrder.push('slow fail');
          return Promise.resolve<ActionResult>(
            err(new Error('second step on the slow board failed')),
          );
        },
      });
      orchestrator.commandProcessor.registerRunner(fastBoard, {
        step: () => {
          completionOrder.push('fast step');
          fastStepDone.resolve();
          return Promise.resolve<ActionResult>(ok(undefined));
        },
      });

      const applied = agent.nextInput('ui_applied');
      agent.emit(
        uiChange(
          'change-parallel',
          boardLayout([
            { instanceId: slowBoard, variant: 'collapsed' },
            { instanceId: fastBoard, variant: 'collapsed' },
          ]),
          [
            step(slowBoard, 'step'),
            step(fastBoard, 'step'),
            step(slowBoard, 'fail'),
          ],
        ),
      );
      const acknowledgement = await applied;

      expect(completionOrder).toEqual(['fast step', 'slow step', 'slow fail']);
      expect(acknowledgement.actionOutcomes).toHaveLength(3);
      expect(acknowledgement.actionOutcomes).toEqual([
        { ok: true },
        { ok: true },
        {
          ok: false,
          error: expect.stringContaining(
            'second step on the slow board failed',
          ),
        },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('reports an Action skipped for a missing runner as skipped at its plan index', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: () => Promise.resolve<ActionResult>(ok(undefined)),
      });

      const applied = agent.nextInput('ui_applied');
      agent.emit(
        uiChange(
          'change-orphan',
          boardLayout([
            { instanceId: mainBoard, variant: 'collapsed' },
            { instanceId: orphanBoard, variant: 'collapsed' },
          ]),
          [
            step(mainBoard, 'record'),
            step(orphanBoard, 'record'),
            step(mainBoard, 'record'),
          ],
        ),
      );
      const acknowledgement = await applied;

      expect(acknowledgement.actionOutcomes).toEqual([
        { ok: true },
        { ok: false, error: expect.stringMatching(/^skipped: /) },
        { ok: true },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('acknowledges a refused Layout with a not run outcome for every Action', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      let recordCalls = 0;
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: () => {
          recordCalls++;
          return Promise.resolve<ActionResult>(ok(undefined));
        },
        expand: () => {
          recordCalls++;
          return Promise.resolve<ActionResult>(ok(undefined));
        },
      });
      const duplicateLeafLayout: TilingLayout = {
        type: 'tiling',
        tree: ['H', tilingLeafToken(mainBoard), tilingLeafToken(mainBoard)],
        instances: [
          {
            instanceId: mainBoard,
            vesselId: VesselId('board'),
            variant: VariantName('collapsed'),
          },
        ],
      };

      const applied = agent.nextInput('ui_applied');
      agent.emit(
        uiChange('change-refused', duplicateLeafLayout, [
          step(mainBoard, 'record'),
          step(mainBoard, 'expand'),
        ]),
      );
      const acknowledgement = await applied;

      expect(acknowledgement.changeId).toBe(ChangeId('change-refused'));
      const notRun = {
        ok: false,
        error: expect.stringMatching(
          /^not run: layout could not be applied: .*set_layout rejected/,
        ),
      };
      expect(acknowledgement.actionOutcomes).toEqual([notRun, notRun]);
      expect(recordCalls).toBe(0);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('reports the Chart from before a refused Layout even when another change is queued behind it', async () => {
    const agent = createMockAgentConnector();
    const seed = boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]);
    const orchestrator = await connectedOrchestrator(agent.connector, {
      initialLayout: seed,
    });
    try {
      const duplicateLeafLayout: TilingLayout = {
        type: 'tiling',
        tree: ['H', tilingLeafToken(newBoard), tilingLeafToken(newBoard)],
        instances: [
          {
            instanceId: newBoard,
            vesselId: VesselId('board'),
            variant: VariantName('collapsed'),
          },
        ],
      };

      agent.emit(uiChange('change-refused', duplicateLeafLayout, []));
      agent.emit(
        uiChange(
          'change-next',
          boardLayout([{ instanceId: fastBoard, variant: 'collapsed' }]),
          [],
        ),
      );
      await waitUntil(() => uiAppliedInputs(agent).length === 2);

      const [refusedApplied] = uiAppliedInputs(agent);
      expect(refusedApplied?.changeId).toBe(ChangeId('change-refused'));
      expect(
        refusedApplied?.chart.instances.map((instance) => instance.instanceId),
      ).toEqual([mainBoard]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('echoes each changeId and acknowledges consecutive changes in arrival order', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      orchestrator.commandProcessor.registerRunner(slowBoard, {
        step: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return ok(undefined);
        },
      });
      orchestrator.commandProcessor.registerRunner(fastBoard, {
        step: () => Promise.resolve<ActionResult>(ok(undefined)),
      });

      agent.emit(
        uiChange(
          'change-first',
          boardLayout([{ instanceId: slowBoard, variant: 'collapsed' }]),
          [step(slowBoard, 'step')],
        ),
      );
      agent.emit(
        uiChange(
          'change-second',
          boardLayout([{ instanceId: fastBoard, variant: 'collapsed' }]),
          [step(fastBoard, 'step')],
        ),
      );
      await waitUntil(() => uiAppliedInputs(agent).length === 2);

      const [firstApplied, secondApplied] = uiAppliedInputs(agent);
      expect(firstApplied?.changeId).toBe(ChangeId('change-first'));
      expect(secondApplied?.changeId).toBe(ChangeId('change-second'));
      expect(
        firstApplied?.chart.instances.map((instance) => instance.instanceId),
      ).toEqual([slowBoard]);
      expect(
        secondApplied?.chart.instances.map((instance) => instance.instanceId),
      ).toEqual([fastBoard]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('surfaces placeholder, message, finished and error to their own subscribers only', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(agent.connector);
    try {
      const received: {
        [K in keyof AgentConversationEvents]: AgentConversationEvents[K][];
      } = {
        accepted: [],
        ui_change: [],
        placeholder: [],
        message: [],
        finished: [],
        error: [],
        conversation_lost: [],
      };
      const arrivalOrder: string[] = [];
      const unsubscribePlaceholder = orchestrator.agent.events.on(
        'placeholder',
        (event) => {
          arrivalOrder.push('placeholder');
          received.placeholder.push(event);
        },
      );
      const onMessage = (event: AgentMessageEvent) => {
        arrivalOrder.push('message');
        received.message.push(event);
      };
      orchestrator.agent.events.on('message', onMessage);
      orchestrator.agent.events.on('finished', (event) => {
        arrivalOrder.push('finished');
        received.finished.push(event);
      });
      orchestrator.agent.events.on('error', (event) => {
        arrivalOrder.push('error');
        received.error.push(event);
      });
      orchestrator.agent.events.on('conversation_lost', (event) => {
        arrivalOrder.push('conversation_lost');
        received.conversation_lost.push(event);
      });
      const subscribeToInternalEvent = () => {
        // @ts-expect-error started is consumed internally and cannot be subscribed to
        orchestrator.agent.events.on('started', () => {});
      };
      void subscribeToInternalEvent;

      const placeholder = placeholderEvent('input-1');
      const firstMessage = messageEvent('Looking');
      const secondMessage = messageEvent(' at it');
      const finished = finishedEvent();
      const error = errorEvent();
      const internalEvents: AgentEvent[] = [
        {
          type: 'accepted',
          version: AGENT_WIRE_VERSION,
          inputId: MessageId('input-1'),
          runId: RunId('run-1'),
          disposition: 'agent',
          ack: 'on it',
        },
        { type: 'started', version: AGENT_WIRE_VERSION, runId: RunId('run-1') },
        {
          type: 'tool_call',
          version: AGENT_WIRE_VERSION,
          runId: RunId('run-1'),
          turnId: 'turn-1',
          callId: CallId('call-1'),
          name: 'search',
        },
        {
          type: 'tool_result',
          version: AGENT_WIRE_VERSION,
          runId: RunId('run-1'),
          turnId: 'turn-1',
          callId: CallId('call-1'),
          name: 'search',
          ok: true,
          summary: 'found it',
        },
      ];

      agent.emit(placeholder);
      for (const event of internalEvents.slice(0, 2)) agent.emit(event);
      agent.emit(firstMessage);
      for (const event of internalEvents.slice(2)) agent.emit(event);
      agent.emit(secondMessage);
      agent.emit(finished);
      agent.emit(error);

      expect(arrivalOrder).toEqual([
        'placeholder',
        'message',
        'message',
        'finished',
        'error',
      ]);
      expect(received.placeholder).toHaveLength(1);
      expect(received.placeholder[0]).toBe(placeholder);
      expect(received.message).toHaveLength(2);
      expect(received.message[0]).toBe(firstMessage);
      expect(received.message[1]).toBe(secondMessage);
      expect(received.finished).toHaveLength(1);
      expect(received.finished[0]).toBe(finished);
      expect(received.error).toHaveLength(1);
      expect(received.error[0]).toBe(error);
      expect(received.conversation_lost).toEqual([]);

      unsubscribePlaceholder();
      orchestrator.agent.events.off('message', onMessage);
      agent.emit(placeholderEvent('input-2'));
      agent.emit(messageEvent('ignored'));

      expect(received.placeholder).toHaveLength(1);
      expect(received.message).toHaveLength(2);
    } finally {
      await orchestrator.dispose();
    }
  });

  describe('surfaced accepted and ui_change events', () => {
    it('emits accepted with the inputId, runId and disposition, and a null runId for noise', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const accepted: AgentConversationEvents['accepted'][] = [];
        orchestrator.agent.events.on('accepted', (event) =>
          accepted.push(event),
        );

        agent.emit(
          agentAcceptedEvent(MessageId('input-agent'), RunId('run-1')),
        );
        agent.emit(agentAcceptedEvent(MessageId('input-noise'), null));

        expect(accepted).toEqual([
          {
            type: 'accepted',
            inputId: MessageId('input-agent'),
            runId: RunId('run-1'),
            disposition: 'agent',
            ack: 'On it',
          },
          {
            type: 'accepted',
            inputId: MessageId('input-noise'),
            runId: null,
            disposition: 'noise',
            ack: '',
          },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits ui_change once after the change is applied and its ui_applied was handed to the connector', async () => {
      const sequence: string[] = [];
      const agent = createMockAgentConnector({
        sendInput: (input) => {
          sequence.push(input.type);
          return Promise.resolve();
        },
      });
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        orchestrator.commandProcessor.registerRunner(newBoard, {
          step: () => Promise.resolve<ActionResult>(ok(undefined)),
          fail: () =>
            Promise.resolve<ActionResult>(err(new Error('step failed'))),
        });
        const changes: AgentConversationEvents['ui_change'][] = [];
        const instanceVisibleAtEvent: boolean[] = [];
        orchestrator.agent.events.on('ui_change', (event) => {
          sequence.push('ui_change');
          changes.push(event);
          instanceVisibleAtEvent.push(
            orchestrator.commandProcessor.store.state.instances.has(newBoard),
          );
        });

        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-surfaced',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [step(newBoard, 'step'), step(newBoard, 'fail')],
          ),
        );
        const acknowledgement = await applied;
        await drainMicrotasks();

        const expectedOutcomes = [
          { ok: true },
          { ok: false, error: expect.stringContaining('step failed') },
        ];
        expect(sequence).toEqual(['ui_applied', 'ui_change']);
        expect(acknowledgement.changeId).toBe(ChangeId('change-surfaced'));
        expect(acknowledgement.actionOutcomes).toEqual(expectedOutcomes);
        expect(changes).toEqual([
          {
            type: 'ui_change',
            runId: RunId('run-1'),
            changeId: ChangeId('change-surfaced'),
            actionOutcomes: expectedOutcomes,
          },
        ]);
        expect(instanceVisibleAtEvent).toEqual([true]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits ui_change for a change whose run already finished', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const changes: AgentConversationEvents['ui_change'][] = [];
        orchestrator.agent.events.on('ui_change', (event) =>
          changes.push(event),
        );
        const inputId = orchestrator.sendMessage('show the board').inputId;
        agent.emit(agentAcceptedEvent(inputId, RunId('run-1')));
        agent.emit(finishedEvent());

        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-after-finished',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [],
          ),
        );
        await applied;
        await drainMicrotasks();

        expect(changes).toEqual([
          {
            type: 'ui_change',
            runId: RunId('run-1'),
            changeId: ChangeId('change-after-finished'),
            actionOutcomes: [],
          },
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('still sends ui_applied when a ui_change listener throws', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const consoleError = spyOn(console, 'error').mockImplementation(() => {});
      try {
        let throwingListenerCalls = 0;
        orchestrator.agent.events.on('ui_change', () => {
          throwingListenerCalls++;
          throw new Error('listener failed');
        });

        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-throwing-listener',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [],
          ),
        );
        await applied;
        await drainMicrotasks();

        expect(throwingListenerCalls).toBe(1);
        expect(uiAppliedInputs(agent).map((input) => input.changeId)).toEqual([
          ChangeId('change-throwing-listener'),
        ]);
      } finally {
        consoleError.mockRestore();
        await orchestrator.dispose();
      }
    });

    it('keeps the ui_applied outcomes intact when a ui_change listener mutates the event outcomes', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        orchestrator.commandProcessor.registerRunner(newBoard, {
          step: () => Promise.resolve<ActionResult>(ok(undefined)),
        });
        orchestrator.agent.events.on('ui_change', (event) => {
          const outcome = event.actionOutcomes[0] as {
            ok: boolean;
            error?: string;
          };
          outcome.ok = false;
          outcome.error = 'tampered';
        });

        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-mutating-listener',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [step(newBoard, 'step')],
          ),
        );
        await applied;
        await drainMicrotasks();

        expect(
          uiAppliedInputs(agent).map((input) => input.actionOutcomes),
        ).toEqual([[{ ok: true }]]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits ui_change and logs a warning when the ui_applied send rejects', async () => {
      const agent = createMockAgentConnector({
        sendInput: () => Promise.reject(new Error('transport down')),
      });
      const orchestrator = await connectedOrchestrator(agent.connector);
      const consoleWarn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const changed = Promise.withResolvers<void>();
        const changes: AgentConversationEvents['ui_change'][] = [];
        orchestrator.agent.events.on('ui_change', (event) => {
          changes.push(event);
          changed.resolve();
        });

        agent.emit(
          uiChange(
            'change-rejected-send',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [],
          ),
        );
        await changed.promise;
        await drainMicrotasks();

        expect(changes.map((change) => change.changeId)).toEqual([
          ChangeId('change-rejected-send'),
        ]);
        expect(uiAppliedInputs(agent)).toHaveLength(1);
        expect(warningsMentioning(consoleWarn, 'change-rejected-send')).toEqual(
          [expect.stringContaining('was not sent')],
        );
      } finally {
        consoleWarn.mockRestore();
        await orchestrator.dispose();
      }
    });

    it('emits ui_change when the ui_applied send never settles', async () => {
      const sequence: string[] = [];
      const agent = createMockAgentConnector({
        sendInput: (input) => {
          sequence.push(input.type);
          return new Promise<void>(() => {});
        },
      });
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        orchestrator.agent.events.on('ui_change', () =>
          sequence.push('ui_change'),
        );

        agent.emit(
          uiChange(
            'change-unsettled-send',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [],
          ),
        );
        await orchestrator.commandProcessor.waitForIdle();
        await drainMicrotasks();

        expect(sequence).toEqual(['ui_applied', 'ui_change']);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits consecutive ui_change events in order while the first send is still pending', async () => {
      const firstSend = Promise.withResolvers<void>();
      let sends = 0;
      const agent = createMockAgentConnector({
        sendInput: () =>
          sends++ === 0 ? firstSend.promise : Promise.resolve(),
      });
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const changes: ChangeId[] = [];
        orchestrator.agent.events.on('ui_change', (event) =>
          changes.push(event.changeId),
        );
        const layout = boardLayout([
          { instanceId: newBoard, variant: 'collapsed' },
        ]);

        agent.emit(uiChange('change-first', layout, []));
        agent.emit(uiChange('change-second', layout, []));
        await orchestrator.commandProcessor.waitForIdle();
        await drainMicrotasks();

        expect(changes).toEqual([
          ChangeId('change-first'),
          ChangeId('change-second'),
        ]);
        firstSend.resolve();
      } finally {
        await orchestrator.dispose();
      }
    });

    it('reports no ui_change for a change still applying when the connector is replaced', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const changes: AgentConversationEvents['ui_change'][] = [];
        orchestrator.agent.events.on('ui_change', (event) =>
          changes.push(event),
        );
        const action = holdNextAction(orchestrator, slowBoard, 'step');
        orchestrator.sendMessage('hello');
        oldAgent.emit(
          uiChange(
            'change-before-swap',
            boardLayout([{ instanceId: slowBoard, variant: 'collapsed' }]),
            [step(slowBoard, 'step')],
          ),
        );
        await action.started;

        orchestrator.setConnector(newAgent.connector);
        action.release();
        await orchestrator.commandProcessor.waitForIdle();
        await drainMicrotasks();

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'connector_replaced' },
        ]);
        expect(changes).toEqual([]);
        expect(uiAppliedInputs(oldAgent)).toEqual([]);
        expect(uiAppliedInputs(newAgent)).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  describe('conversation lost on transport close', () => {
    it('emits one disconnected loss for an unclean close after an utterance, then resets', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        orchestrator.sendMessage('hello');

        agent.close({ clean: false });
        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'disconnected' },
        ]);

        agent.close({ clean: false });
        expect(losses).toHaveLength(1);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits one disconnected loss for a clean close after an agent event, and settles utterances while disconnected as not submitted', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        agent.emit(messageEvent('unprompted'));

        agent.close({ clean: true });
        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'disconnected' },
        ]);
        const submission = orchestrator.sendMessage('anyone there');
        expect(await submission.result).toMatchObject({
          inputId: submission.inputId,
          status: 'not_submitted',
          error: { message: 'Orchestrator is not connected' },
        });
        expect(
          agent.inputs.filter((input) => input.type === 'utterance'),
        ).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('applies a change still running at an unclean close but sends no ui_applied or ui_change into the reconnected session', async () => {
      const clock = FakeTimers.install({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      });
      const agent = createMockAgentConnector({
        connect: mock(() => Promise.resolve()),
      });
      const orchestrator = await connectedOrchestrator(agent.connector, {
        connection: { initialDelayMs: 1 },
      });
      try {
        const losses = recordConversationLosses(orchestrator);
        const changes: AgentConversationEvents['ui_change'][] = [];
        orchestrator.agent.events.on('ui_change', (event) =>
          changes.push(event),
        );
        const action = holdNextAction(orchestrator, slowBoard, 'step');
        orchestrator.sendMessage('hello');
        agent.emit(
          uiChange(
            'change-from-lost-session',
            boardLayout([{ instanceId: slowBoard, variant: 'collapsed' }]),
            [step(slowBoard, 'step')],
          ),
        );
        await action.started;

        const connect = agent.connector.connect as unknown as {
          mock: { calls: unknown[] };
        };
        const connectsBeforeClose = connect.mock.calls.length;
        agent.close({ clean: false });
        await clock.tickAsync(1);
        expect(connect.mock.calls.length).toBeGreaterThan(connectsBeforeClose);
        action.release();
        await orchestrator.commandProcessor.waitForIdle();
        await drainMicrotasks();

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'disconnected' },
        ]);
        expect(
          orchestrator.commandProcessor.store.state.instances.has(slowBoard),
        ).toBe(true);
        expect(uiAppliedInputs(agent)).toEqual([]);
        expect(changes).toEqual([]);
      } finally {
        await orchestrator.dispose();
        clock.uninstall();
      }
    });

    it('reports the loss on an explicit disconnect even when the old transport never reports its close', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const actionStarted = Promise.withResolvers<void>();
        const releaseAction = Promise.withResolvers<void>();
        orchestrator.commandProcessor.registerRunner(slowBoard, {
          step: async () => {
            actionStarted.resolve();
            await releaseAction.promise;
            return ok(undefined);
          },
        });
        orchestrator.sendMessage('hello');
        agent.emit(
          uiChange(
            'change-before-disconnect',
            boardLayout([{ instanceId: slowBoard, variant: 'collapsed' }]),
            [step(slowBoard, 'step')],
          ),
        );
        await actionStarted.promise;

        await orchestrator.disconnect();
        await orchestrator.connect();
        releaseAction.resolve();
        await orchestrator.commandProcessor.waitForIdle();
        await settleBriefly();
        agent.close({ clean: true });

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'disconnected' },
        ]);
        expect(uiAppliedInputs(agent)).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('settles an utterance sent from a loss listener as not submitted while an explicit disconnect is closing the connection', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        orchestrator.sendMessage('hello');
        let lateSend: AgentMessageSubmission | undefined;
        orchestrator.agent.events.on('conversation_lost', () => {
          lateSend ??= orchestrator.sendMessage('are you still there');
        });

        await orchestrator.disconnect();

        expect(lateSend).toBeDefined();
        expect(await lateSend?.result).toMatchObject({
          status: 'not_submitted',
          error: { message: 'Orchestrator is not connected' },
        });
        expect(
          agent.inputs.filter((input) => input.type === 'utterance'),
        ).toHaveLength(1);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('reports the loss of an utterance whose send is still in flight at the close', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);
        const send = holdNextSend(agent.connector);

        const sent = orchestrator.sendMessage('hello');
        agent.close({ clean: false });
        send.release();
        await drainMicrotasks();
        expect(await sent.result).toMatchObject({
          inputId: sent.inputId,
          status: 'lost',
          lostReason: 'disconnected',
        });

        expect(losses).toEqual([
          { type: 'conversation_lost', reason: 'disconnected' },
        ]);
        agent.close({ clean: false });
        expect(losses).toHaveLength(1);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('sends no ui_applied into a new session when a command_start listener closes the transport', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        orchestrator.sendMessage('hello');
        let closed = false;
        orchestrator.commandProcessor.events.on('command_start', () => {
          if (closed) return;
          closed = true;
          agent.close({ clean: false });
        });

        agent.emit(
          uiChange(
            'change-across-close',
            boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
            [],
          ),
        );
        await orchestrator.commandProcessor.waitForIdle();
        await settleBriefly();

        expect(closed).toBe(true);
        expect(uiAppliedInputs(agent)).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits nothing on close when no conversation exists', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      try {
        const losses = recordConversationLosses(orchestrator);

        agent.close({ clean: false });
        agent.close({ clean: true });

        expect(losses).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });
  });

  it('emits connector_replaced when the connector is swapped while the first utterance is still sending', async () => {
    const oldAgent = createMockAgentConnector();
    const newAgent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(oldAgent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      const send = holdNextSend(oldAgent.connector);

      const sent = orchestrator.sendMessage('hello');
      orchestrator.setConnector(newAgent.connector);
      send.release();
      await drainMicrotasks();
      expect(await sent.result).toMatchObject({
        inputId: sent.inputId,
        status: 'lost',
        lostReason: 'connector_replaced',
      });
      newAgent.close({ clean: false });

      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'connector_replaced' },
      ]);
    } finally {
      await orchestrator.dispose();
    }
  });

  it('emits connector_replaced on a connector swap and ignores UI changes from the old connector', async () => {
    const oldAgent = createMockAgentConnector();
    const newAgent = createMockAgentConnector();
    const orchestrator = await connectedOrchestrator(oldAgent.connector);
    try {
      const losses = recordConversationLosses(orchestrator);
      let recordCalls = 0;
      orchestrator.commandProcessor.registerRunner(newBoard, {
        record: () => {
          recordCalls++;
          return Promise.resolve<ActionResult>(ok(undefined));
        },
      });
      orchestrator.sendMessage('hello');

      orchestrator.setConnector(newAgent.connector);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'connector_replaced' },
      ]);

      oldAgent.emit(
        uiChange(
          'change-stale',
          boardLayout([{ instanceId: newBoard, variant: 'collapsed' }]),
          [step(newBoard, 'record')],
        ),
      );
      await settleBriefly();

      expect(recordCalls).toBe(0);
      expect(
        orchestrator.commandProcessor.store.state.instances.has(newBoard),
      ).toBe(false);
      expect(uiAppliedInputs(oldAgent)).toEqual([]);
      expect(uiAppliedInputs(newAgent)).toEqual([]);
    } finally {
      await orchestrator.dispose();
    }
  });

  describe('dispose', () => {
    it('settles an utterance sent after dispose as not submitted', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      await orchestrator.dispose();

      const submission = orchestrator.sendMessage('too late');
      expect(await submission.result).toMatchObject({
        inputId: submission.inputId,
        status: 'not_submitted',
        error: { message: 'Orchestrator is disposed' },
      });
      expect(agent.inputs).toEqual([]);
    });

    it('emits a disconnected loss and settles the open input lost when disposed after an utterance', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const losses = recordConversationLosses(orchestrator);
      const submission = orchestrator.sendMessage('hello');
      await drainMicrotasks();

      await orchestrator.dispose();

      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'disconnected' },
      ]);
      expect(await submission.result).toMatchObject({
        inputId: submission.inputId,
        status: 'lost',
        lostReason: 'disconnected',
      });
    });

    it('sends no acknowledgement for a change still applying at dispose and reports the conversation lost once', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const losses = recordConversationLosses(orchestrator);
      const actionStarted = Promise.withResolvers<void>();
      const releaseAction = Promise.withResolvers<void>();
      orchestrator.commandProcessor.registerRunner(mainBoard, {
        record: async () => {
          actionStarted.resolve();
          await releaseAction.promise;
          return ok(undefined);
        },
      });

      agent.emit(
        uiChange(
          'change-during-dispose',
          boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
          [step(mainBoard, 'record')],
        ),
      );
      await actionStarted.promise;
      await orchestrator.dispose();
      releaseAction.resolve();
      await settleBriefly();

      expect(uiAppliedInputs(agent)).toEqual([]);
      expect(losses).toEqual([
        { type: 'conversation_lost', reason: 'disconnected' },
      ]);
    });
  });

  it('constructs over HttpConnector and settles utterances as not submitted because the agent wire is unsupported', async () => {
    const connector = new HttpConnector({ baseUrl: 'http://localhost:0' });
    const unsupported: unknown = await connector
      .sendInput({} as Parameters<HttpConnector['sendInput']>[0])
      .catch((error: unknown) => error);
    expect(unsupported).toBeInstanceOf(AgentWireUnsupportedError);
    const orchestrator = new Orchestrator(connector);
    try {
      await orchestrator.connect();
      const submission = orchestrator.sendMessage('hello');
      expect(await submission.result).toMatchObject({
        inputId: submission.inputId,
        status: 'not_submitted',
        error: { message: (unsupported as Error).message },
      });
    } finally {
      await orchestrator.dispose();
    }
  });

  it('keeps rejecting a concurrent processIntent with RequestInFlightError while agent listeners are attached', async () => {
    const agent = createMockAgentConnector();
    const intentResponse = Promise.withResolvers<MaelstromResponse>();
    let intentRequestId: MessageId | undefined;
    const connector: EngineConnector = {
      ...agent.connector,
      process: (message) => {
        intentRequestId = message.id;
        return intentResponse.promise;
      },
    };
    const orchestrator = await connectedOrchestrator(connector);
    try {
      orchestrator.agent.events.on('placeholder', () => {});
      orchestrator.agent.events.on('message', () => {});
      orchestrator.agent.events.on('finished', () => {});
      orchestrator.agent.events.on('error', () => {});
      orchestrator.agent.events.on('conversation_lost', () => {});

      const first = orchestrator.processIntent('first');
      await expect(orchestrator.processIntent('second')).rejects.toThrow(
        RequestInFlightError,
      );

      if (intentRequestId === undefined)
        throw new Error('Expected the intent to reach the connector');
      intentResponse.resolve(createMockEmptyResponse(intentRequestId));
      await first;
    } finally {
      await orchestrator.dispose();
    }
  });

  describe('conversation ended by a store subscriber during the send', () => {
    it('settles the utterance as not submitted and sends it on neither connector when a store subscriber replaces the connector as the input turns pending', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      const releaseSubscriber = orchestrator.agent.store.subscribe(() => {
        if (orchestrator.agent.store.state.run?.status === 'pending')
          orchestrator.setConnector(newAgent.connector);
      });
      try {
        const submission = orchestrator.sendMessage('hello');
        expect(await submission.result).toMatchObject({
          inputId: submission.inputId,
          status: 'not_submitted',
          error: {
            message: 'Agent conversation ended before the utterance was sent',
          },
        });
        await settleBriefly();

        expect(oldAgent.inputs).toEqual([]);
        expect(newAgent.inputs).toEqual([]);
        expect(orchestrator.agent.store.state.run).toMatchObject({
          inputId: submission.inputId,
          status: 'not_submitted',
        });
      } finally {
        releaseSubscriber.unsubscribe();
        await orchestrator.dispose();
      }
    });

    it('settles the utterance as not submitted and never sends it when a store subscriber disposes the Orchestrator as the input turns pending', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      let disposal: Promise<void> | undefined;
      orchestrator.agent.store.subscribe(() => {
        if (orchestrator.agent.store.state.run?.status === 'pending')
          disposal ??= orchestrator.dispose();
      });

      const submission = orchestrator.sendMessage('hello');
      expect(await submission.result).toMatchObject({
        inputId: submission.inputId,
        status: 'not_submitted',
        error: {
          message: 'Agent conversation ended before the utterance was sent',
        },
      });
      await disposal;
      await settleBriefly();

      expect(agent.inputs).toEqual([]);
      expect(orchestrator.agent.store.state.run).toMatchObject({
        inputId: submission.inputId,
        status: 'not_submitted',
      });
    });

    it('still settles an earlier open input lost when a store subscriber replaces the connector as a later input turns pending', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      const earlier = orchestrator.sendMessage('first');
      const releaseSubscriber = orchestrator.agent.store.subscribe(() => {
        if (orchestrator.agent.store.state.run?.status === 'pending')
          orchestrator.setConnector(newAgent.connector);
      });
      try {
        const later = orchestrator.sendMessage('second');

        expect(await earlier.result).toMatchObject({
          inputId: earlier.inputId,
          status: 'lost',
          lostReason: 'connector_replaced',
        });
        expect(await later.result).toMatchObject({
          inputId: later.inputId,
          status: 'not_submitted',
        });
        expect(
          oldAgent.inputs.map((input) =>
            input.type === 'utterance' ? input.text : input.type,
          ),
        ).toEqual(['first']);
        expect(newAgent.inputs).toEqual([]);
      } finally {
        releaseSubscriber.unsubscribe();
        await orchestrator.dispose();
      }
    });
  });

  describe('client diagnostics', () => {
    it('emits one input sent event with only the input id before the utterance is sent', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const log = recordSendOrder(agent.connector);
      const observations = recordDiagnostics(orchestrator, log);
      try {
        const inputId = orchestrator.sendMessage('CANARY_utterance').inputId;

        const sent = observationsOfKind(
          observations,
          'client.agent.input.sent',
        );
        expect(sent).toHaveLength(1);
        const [observation] = sent;
        expect(observation?.event.metadata).toEqual({ inputId });
        expect(observation?.event.requestId).toBeUndefined();
        expect(observation?.event.runId).toBeUndefined();
        expect(observation?.readContent).toBeUndefined();
        expect(log).toEqual([
          'diagnostic client.agent.input.sent',
          'send utterance',
        ]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits one ui applied event with the change id and the injected clock duration before the acknowledgement is sent', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const log = recordSendOrder(agent.connector);
      const observations = recordDiagnostics(orchestrator, log);
      const clock = installClock(1_000);
      try {
        const releaseAction = Promise.withResolvers<void>();
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: async () => {
            await releaseAction.promise;
            return ok(undefined);
          },
        });

        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-timed',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        clock.set(1_042);
        releaseAction.resolve();
        await applied;

        const appliedEvents = observationsOfKind(
          observations,
          'client.agent.ui.applied',
        );
        expect(appliedEvents).toHaveLength(1);
        const [observation] = appliedEvents;
        expect(observation?.event.metadata).toEqual({
          changeId: ChangeId('change-timed'),
          durationMs: 42,
        });
        expect(observation?.event.requestId).toBeUndefined();
        expect(observation?.event.runId).toBeUndefined();
        expect(observation?.readContent).toBeUndefined();
        expect(log).toEqual([
          'diagnostic client.agent.ui.applied',
          'send ui_applied',
        ]);
      } finally {
        await orchestrator.dispose();
        clock.restore();
      }
    });

    it('emits no ui applied event for an acknowledgement fenced by a connector swap', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      const observations = recordDiagnostics(orchestrator);
      try {
        const action = holdNextAction(orchestrator, mainBoard, 'record');

        oldAgent.emit(
          uiChange(
            'change-fenced',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        await action.started;
        orchestrator.setConnector(newAgent.connector);
        action.release();
        await orchestrator.commandProcessor.waitForIdle();
        await settleBriefly();

        expect(uiAppliedInputs(oldAgent)).toEqual([]);
        expect(
          observationsOfKind(observations, 'client.agent.ui.applied'),
        ).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('emits no ui applied event for an acknowledgement whose Agent Session ended', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const observations = recordDiagnostics(orchestrator);
      try {
        const action = holdNextAction(orchestrator, mainBoard, 'record');

        agent.emit(
          uiChange(
            'change-session-ended',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        await action.started;
        agent.close({ clean: false });
        action.release();
        await orchestrator.commandProcessor.waitForIdle();
        await settleBriefly();

        expect(uiAppliedInputs(agent)).toEqual([]);
        expect(
          observationsOfKind(observations, 'client.agent.ui.applied'),
        ).toEqual([]);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('keeps exactly one input sent event when the utterance send fails and settles the input lost', async () => {
      const agent = createMockAgentConnector();
      const sendFailure = new Error('transport refused the utterance');
      agent.connector.sendInput = () => Promise.reject(sendFailure);
      const orchestrator = await connectedOrchestrator(agent.connector);
      const observations = recordDiagnostics(orchestrator);
      try {
        const submission = orchestrator.sendMessage('hello');
        expect(await submission.result).toMatchObject({
          inputId: submission.inputId,
          status: 'lost',
          lostReason: 'send_failed',
        });

        const sent = observationsOfKind(
          observations,
          'client.agent.input.sent',
        );
        expect(sent).toHaveLength(1);
        expect(Object.keys(sent[0]?.event.metadata ?? {})).toEqual(['inputId']);
      } finally {
        await orchestrator.dispose();
      }
    });

    it('keeps exactly one ui applied event when the acknowledgement send fails and only warns', async () => {
      const agent = createMockAgentConnector();
      const sendFailure = new Error('transport refused the acknowledgement');
      const attempted = Promise.withResolvers<void>();
      const send = agent.connector.sendInput.bind(agent.connector);
      agent.connector.sendInput = (input) => {
        if (input.type !== 'ui_applied') return send(input);
        attempted.resolve();
        return Promise.reject(sendFailure);
      };
      const orchestrator = await connectedOrchestrator(agent.connector);
      const observations = recordDiagnostics(orchestrator);
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: () => Promise.resolve<ActionResult>(ok(undefined)),
        });

        agent.emit(
          uiChange(
            'change-send-failed',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        await attempted.promise;
        await waitUntil(() => warn.mock.calls.length > 0);

        const appliedEvents = observationsOfKind(
          observations,
          'client.agent.ui.applied',
        );
        expect(appliedEvents).toHaveLength(1);
        expect(appliedEvents[0]?.event.metadata).toMatchObject({
          changeId: ChangeId('change-send-failed'),
        });
        expect(warn).toHaveBeenCalledWith(
          '[Orchestrator]',
          'Agent conversation: ui_applied for change-send-failed was not sent',
          sendFailure,
        );
      } finally {
        await orchestrator.dispose();
        warn.mockRestore();
      }
    });

    it('settles the utterance as not submitted and sends it on neither connector when a diagnostic observer replaces the connector during the input sent event', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      const releaseObserver = orchestrator.diagnostics.subscribe(
        (observation) => {
          if (observation.event.kind === 'client.agent.input.sent')
            orchestrator.setConnector(newAgent.connector);
        },
      );
      try {
        const submission = orchestrator.sendMessage('hello');
        expect(await submission.result).toMatchObject({
          inputId: submission.inputId,
          status: 'not_submitted',
          error: {
            message: 'Agent conversation ended before the utterance was sent',
          },
        });
        await settleBriefly();

        expect(oldAgent.inputs).toEqual([]);
        expect(newAgent.inputs).toEqual([]);
      } finally {
        releaseObserver();
        await orchestrator.dispose();
      }
    });

    it('sends no ui_applied on the retired connector when a diagnostic observer replaces the connector during the ui applied event', async () => {
      const oldAgent = createMockAgentConnector();
      const newAgent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(oldAgent.connector);
      const observed = Promise.withResolvers<void>();
      const releaseObserver = orchestrator.diagnostics.subscribe(
        (observation) => {
          if (observation.event.kind !== 'client.agent.ui.applied') return;
          orchestrator.setConnector(newAgent.connector);
          observed.resolve();
        },
      );
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: () => Promise.resolve<ActionResult>(ok(undefined)),
        });

        oldAgent.emit(
          uiChange(
            'change-observer-swap',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        await observed.promise;
        await settleBriefly();

        expect(uiAppliedInputs(oldAgent)).toEqual([]);
        expect(uiAppliedInputs(newAgent)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
          '[Orchestrator]',
          expect.stringContaining(
            'ui_applied for change-observer-swap not sent',
          ),
        );
      } finally {
        releaseObserver();
        await orchestrator.dispose();
        warn.mockRestore();
      }
    });

    it('stops delivering agent diagnostics once every observer is released and still sends the utterance and ui_applied inputs', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const observations: DiagnosticObservation[] = [];
      const metadataKinds: string[] = [];
      const releaseObservations = orchestrator.diagnostics.subscribe(
        (observation) => observations.push(observation),
      );
      const releaseMetadata = orchestrator.diagnostics.subscribeMetadata(
        (kind) => {
          metadataKinds.push(kind);
        },
      );
      try {
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: () => Promise.resolve<ActionResult>(ok(undefined)),
        });

        const firstInputId = orchestrator.sendMessage('first').inputId;
        expect(
          observationsOfKind(observations, 'client.agent.input.sent'),
        ).toHaveLength(1);
        expect(
          metadataKinds.filter((kind) => kind === 'client.agent.input.sent'),
        ).toHaveLength(1);

        releaseObservations();
        releaseMetadata();
        expect(orchestrator.diagnostics.locallyObserved).toBe(false);
        const observedCount = observations.length;
        const metadataCount = metadataKinds.length;

        const secondInputId = orchestrator.sendMessage('second').inputId;
        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-unobserved',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        const acknowledgement = await applied;

        expect(observations).toHaveLength(observedCount);
        expect(metadataKinds).toHaveLength(metadataCount);
        expect(agent.inputs.map((input) => input.type)).toEqual([
          'utterance',
          'utterance',
          'ui_applied',
        ]);
        expect(agent.inputs[0]).toMatchObject({
          inputId: firstInputId,
          text: 'first',
        });
        expect(agent.inputs[1]).toMatchObject({
          inputId: secondInputId,
          text: 'second',
        });
        expect(acknowledgement.changeId).toBe(ChangeId('change-unobserved'));
        expect(acknowledgement.actionOutcomes).toEqual([{ ok: true }]);
      } finally {
        releaseObservations();
        releaseMetadata();
        await orchestrator.dispose();
      }
    });

    it('keeps utterance text out of diagnostic and operational metadata', async () => {
      const agent = createMockAgentConnector();
      const orchestrator = await connectedOrchestrator(agent.connector);
      const observations = recordDiagnostics(orchestrator);
      const metadata: unknown[] = [];
      const releaseMetadata = orchestrator.diagnostics.subscribeMetadata(
        (kind, fields) => {
          metadata.push({ kind, fields });
        },
      );
      try {
        orchestrator.commandProcessor.registerRunner(mainBoard, {
          record: () => Promise.resolve<ActionResult>(ok(undefined)),
        });

        orchestrator.sendMessage('CANARY_utterance');
        const applied = agent.nextInput('ui_applied');
        agent.emit(
          uiChange(
            'change-private',
            boardLayout([{ instanceId: mainBoard, variant: 'collapsed' }]),
            [step(mainBoard, 'record')],
          ),
        );
        await applied;

        const agentObservations = observations.filter((observation) =>
          observation.event.kind.startsWith('client.agent.'),
        );
        expect(
          agentObservations.map((observation) => observation.event.kind),
        ).toEqual(['client.agent.input.sent', 'client.agent.ui.applied']);
        expect(JSON.stringify(agentObservations)).not.toContain('CANARY');
        expect(JSON.stringify(metadata)).not.toContain('CANARY');
      } finally {
        releaseMetadata();
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
    readyTimeoutMs: shortReadyTimeoutMs,
    ...options,
  } as OrchestratorOptions);
  await orchestrator.commandProcessor.waitForIdle();
  await orchestrator.connect();
  return orchestrator;
}

function boardLayout(
  boards: readonly { instanceId: InstanceId; variant: string }[],
): TilingLayout {
  const leaves = boards.map((board) => tilingLeafToken(board.instanceId));
  return {
    type: 'tiling',
    tree: leaves.length > 1 ? ['H', ...leaves] : leaves,
    instances: boards.map((board) => ({
      instanceId: board.instanceId,
      vesselId: VesselId('board'),
      variant: VariantName(board.variant),
    })),
  };
}

function step(instanceId: InstanceId, action: string): ActionExecution {
  return { instanceId, action: ActionName(action) };
}

function uiChange(
  changeId: string,
  layout: TilingLayout,
  executionPlan: ActionExecution[],
): AgentUiChangeEvent {
  return {
    type: 'ui_change',
    version: AGENT_WIRE_VERSION,
    runId: RunId('run-1'),
    changeId: ChangeId(changeId),
    response: {
      type: 'maelstrom_response',
      requestId: MessageId(`response-${changeId}`),
      userMessage: '',
      rationale: 'agent change',
      executionPlan,
      layout,
    },
  };
}

function placeholderEvent(inputId: string): AgentPlaceholderEvent {
  return {
    type: 'placeholder',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId(inputId),
    text: 'working on it',
  };
}

function messageEvent(delta: string): AgentMessageEvent {
  return {
    type: 'message',
    version: AGENT_WIRE_VERSION,
    runId: RunId('run-1'),
    turnId: 'turn-1',
    delta,
  };
}

function finishedEvent(): AgentFinishedEvent {
  return {
    type: 'finished',
    version: AGENT_WIRE_VERSION,
    runId: RunId('run-1'),
    ok: true,
    reason: 'completed',
    reply: 'Looking at it',
    metrics: {
      turns: 1,
      toolCalls: { requested: 1, admitted: 1 },
      elapsedMs: 5,
      inputTokens: 10,
      outputTokens: 4,
    },
  };
}

function errorEvent(): AgentErrorEvent {
  return {
    type: 'error',
    version: AGENT_WIRE_VERSION,
    inputId: MessageId('input-1'),
    error: 'something went wrong',
  };
}

function uiAppliedInputs(agent: MockAgentConnector): AgentUiAppliedInput[] {
  return agent.inputs.filter(
    (input): input is AgentUiAppliedInput => input.type === 'ui_applied',
  );
}

function holdNextSend(connector: EngineConnector): { release(): void } {
  const send = connector.sendInput.bind(connector);
  const held = Promise.withResolvers<void>();
  let holding = true;
  connector.sendInput = async (input) => {
    if (!holding) return send(input);
    holding = false;
    await held.promise;
    return send(input);
  };
  return { release: () => held.resolve() };
}

function holdNextAction(
  orchestrator: Orchestrator,
  instanceId: InstanceId,
  action: string,
): { started: Promise<void>; release(): void } {
  const started = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  orchestrator.commandProcessor.registerRunner(instanceId, {
    [action]: async () => {
      started.resolve();
      await held.promise;
      return ok(undefined);
    },
  });
  return { started: started.promise, release: () => held.resolve() };
}

function recordDiagnostics(
  orchestrator: Orchestrator,
  log?: string[],
): DiagnosticObservation[] {
  const observations: DiagnosticObservation[] = [];
  orchestrator.diagnostics.subscribe((observation) => {
    observations.push(observation);
    if (observation.event.kind.startsWith('client.agent.'))
      log?.push(`diagnostic ${observation.event.kind}`);
  });
  return observations;
}

function observationsOfKind(
  observations: readonly DiagnosticObservation[],
  kind: string,
): DiagnosticObservation[] {
  return observations.filter((observation) => observation.event.kind === kind);
}

function recordSendOrder(connector: EngineConnector): string[] {
  const log: string[] = [];
  const send = connector.sendInput.bind(connector);
  connector.sendInput = (input) => {
    log.push(`send ${input.type}`);
    return send(input);
  };
  return log;
}

function installClock(start: number): {
  set(now: number): void;
  restore(): void;
} {
  let now = start;
  const spy = spyOn(performance, 'now').mockImplementation(() => now);
  return {
    set: (next) => {
      now = next;
    },
    restore: () => spy.mockRestore(),
  };
}

function recordConversationLosses(
  orchestrator: Orchestrator,
): ConversationLostEvent[] {
  const losses: ConversationLostEvent[] = [];
  orchestrator.agent.events.on('conversation_lost', (event) =>
    losses.push(event),
  );
  return losses;
}

// Runs after every pending microtask, without depending on elapsed time.
async function drainMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function warningsMentioning(
  consoleWarn: { mock: { calls: unknown[][] } },
  text: string,
): string[] {
  return consoleWarn.mock.calls
    .map((call) => call.map(String).join(' '))
    .filter((line) => line.includes(text));
}

// Long enough for a dropped change to have run its Layout, Actions and
// acknowledgement had it not been dropped.
async function settleBriefly(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('waitUntil: condition did not hold in time');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
