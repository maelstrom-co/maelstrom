import { describe, expect, test } from 'bun:test';

import {
  Orchestrator,
  type OrchestratorOptions,
  type SettledAgentRun,
} from '@maelstrom-co/client';
import {
  agentAcceptedEvent,
  agentFinishedEvent,
  createMockAgentConnector,
  type MockAgentConnector,
} from '@maelstrom-co/client/_testing';
import {
  type ChartRequestMessage,
  type MaelstromResponse,
  type MessageId,
  RunId,
} from '@maelstrom-co/protocol';
import type { RealtimeInstance } from '@maelstrom-co/realtime';

import { createMockConnector } from './__tests__/mock-connector.js';
import {
  createRealtimeInstance,
  type RealtimeInstanceOptions,
} from './realtime-instance.js';

async function flush() {
  for (let count = 0; count < 20; count++) await Promise.resolve();
}

test('createRealtimeInstance shares FIFO admission and retires only its pending voice lifetime', async () => {
  const sent: ChartRequestMessage[] = [];
  const release: Array<(response: MaelstromResponse) => void> = [];
  const client = new Orchestrator(
    createMockConnector({
      process: (request) => {
        sent.push(request);
        return new Promise((resolve) => {
          release.push(resolve);
        });
      },
    }),
  );
  try {
    await client.connect();
    const instance = createRealtimeInstance(client);
    const scope = instance.createIntentScope?.();
    expect(scope).toBeDefined();
    if (!scope) throw new Error('missing scoped admission');
    const active = client.enqueueIntent('typed-active');
    await flush();
    const first = scope.enqueueIntent('voice-first');
    const typed = client.enqueueIntent('typed-second');
    const retired = scope.enqueueIntent('voice-retired');
    expect(first.store.state).toMatchObject({
      status: 'queued',
      queuePosition: 1,
    });
    expect(typed.store.state).toMatchObject({
      status: 'queued',
      queuePosition: 2,
    });
    expect(sent).toHaveLength(1);
    const finish = (index: number) =>
      release[index]({
        type: 'maelstrom_response',
        requestId: sent[index].id,
        userMessage: 'Applied',
        rationale: '',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      });
    finish(0);
    await active.result;
    await flush();
    expect(first.store.state.status).toBe('processing');
    scope.retire();
    expect(await retired.result).toEqual({
      status: 'not_submitted',
      reason: 'owner_retired',
    });
    finish(1);
    expect((await first.result).status).toBe('applied');
    await flush();
    expect(sent[2].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'typed-second',
    });
    finish(2);
    expect((await typed.result).status).toBe('applied');
    expect(sent).toHaveLength(3);
  } finally {
    await client.dispose();
  }
});

type SendAgentMessageOption = NonNullable<
  RealtimeInstanceOptions['sendAgentMessage']
>;

const runA = RunId('run-a');

describe('createRealtimeInstance sendAgentMessage', () => {
  test('is absent when the option is not set', async () => {
    await withAgentOrchestrator(async ({ orchestrator }) => {
      expect('sendAgentMessage' in createRealtimeInstance(orchestrator)).toBe(
        false,
      );
      expect(
        'sendAgentMessage' in createRealtimeInstance(orchestrator, {}),
      ).toBe(false);
    });
  });

  test('calls the option with the orchestrator and text, then resolves the settled run of its submission', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      expect(send.calls).toEqual([{ orchestrator, text: 'show the board' }]);
      const inputId = send.inputIds[0];
      await flush();
      expect(agent.inputs).toMatchObject([
        { type: 'utterance', inputId, text: 'show the board', source: 'voice' },
      ]);

      agent.emit(agentAcceptedEvent(inputId, runA, 'ui_only'));
      agent.emit(agentFinishedEvent(runA, { reply: 'Board is up' }));

      expect(await outcome).toMatchObject({
        inputId,
        status: 'finished',
        disposition: 'ui_only',
        reply: 'Board is up',
      });
    });
  });

  test('resolves lost when the connection drops while the run is open', async () => {
    await withAgentOrchestrator(async ({ orchestrator, agent }) => {
      const send = sendThroughOrchestrator();
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: send.option,
      });

      const outcome = requireSendAgentMessage(instance)('show the board');
      await flush();
      agent.emit(agentAcceptedEvent(send.inputIds[0], runA));
      agent.close({ clean: false });

      expect(await outcome).toMatchObject({
        status: 'lost',
        lostReason: 'disconnected',
      });
    });
  });

  test('resolves not_submitted while the engine is not connected', async () => {
    const agent = createMockAgentConnector();
    const orchestrator = new Orchestrator(agent.connector);
    try {
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: sendThroughOrchestrator().option,
      });

      expect(
        await requireSendAgentMessage(instance)('show the board'),
      ).toMatchObject({
        status: 'not_submitted',
        error: { message: 'Orchestrator is not connected' },
      });
      expect(agent.inputs).toEqual([]);
    } finally {
      await orchestrator.dispose();
    }
  });

  test('rejects when the option throws, so the session reports the outcome as unconfirmed', async () => {
    await withAgentOrchestrator(async ({ orchestrator }) => {
      const failure = new Error('submit path broke');
      const instance = createRealtimeInstance(orchestrator, {
        sendAgentMessage: () => {
          throw failure;
        },
      });

      await expect(
        requireSendAgentMessage(instance)('show the board'),
      ).rejects.toBe(failure);
    });
  });
});

async function withAgentOrchestrator(
  body: (context: {
    orchestrator: Orchestrator;
    agent: MockAgentConnector;
  }) => Promise<void>,
  options: OrchestratorOptions = {},
): Promise<void> {
  const agent = createMockAgentConnector();
  const orchestrator = new Orchestrator(agent.connector, options);
  try {
    await orchestrator.connect();
    await body({ orchestrator, agent });
  } finally {
    await orchestrator.dispose();
  }
}

function sendThroughOrchestrator(): {
  option: SendAgentMessageOption;
  calls: Array<{ orchestrator: Orchestrator; text: string }>;
  inputIds: MessageId[];
} {
  const calls: Array<{ orchestrator: Orchestrator; text: string }> = [];
  const inputIds: MessageId[] = [];
  return {
    calls,
    inputIds,
    option: (orchestrator, text) => {
      calls.push({ orchestrator, text });
      const submission = orchestrator.sendMessage(text, { source: 'voice' });
      inputIds.push(submission.inputId);
      return submission;
    },
  };
}

function requireSendAgentMessage(
  instance: RealtimeInstance,
): (text: string) => Promise<SettledAgentRun> {
  const send = instance.sendAgentMessage;
  if (!send) throw new Error('instance has no sendAgentMessage');
  return (text) => send.call(instance, text);
}
