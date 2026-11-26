import { describe, expect, test } from 'bun:test';

import {
  type IntentSubmission,
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

test.each([false, true])(
  'createRealtimeInstance shares FIFO admission and retires only its pending voice lifetime, custom scope: %s',
  async (customScope) => {
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
      const tracked: IntentSubmission[] = [];
      const instance = createRealtimeInstance(
        client,
        customScope
          ? {
              createIntentScope: (orchestrator) => {
                const underlying = orchestrator.createIntentScope();
                return {
                  enqueueIntent: (intent) => {
                    const submission = underlying.enqueueIntent(intent);
                    tracked.push(submission);
                    return submission;
                  },
                  retire: () => underlying.retire(),
                };
              },
            }
          : {},
      );
      const scope = instance.createIntentScope?.();
      expect(scope).toBeDefined();
      if (!scope) throw new Error('missing scoped admission');
      const active = client.enqueueIntent('typed-active');
      await flush();
      const first = scope.enqueueIntent('voice-first');
      const typed = client.enqueueIntent('typed-second');
      const retired = scope.enqueueIntent('voice-retired');
      expect(first.accepted).toBe(true);
      expect(retired.accepted).toBe(true);
      if (customScope) {
        expect(first).toBe(tracked[0]);
        expect(retired).toBe(tracked[1]);
      }
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
      const refused = scope.enqueueIntent('after-retirement');
      expect(refused.accepted).toBe(false);
      expect(await refused.result).toEqual({
        status: 'not_submitted',
        reason: 'owner_retired',
      });
      if (customScope) expect(refused).toBe(tracked[2]);
    } finally {
      await client.dispose();
    }
  },
);

test('createRealtimeInstance lazily delegates scope creation to the factory with its owning Orchestrator', async () => {
  const client = new Orchestrator(createMockConnector());
  const owners: Orchestrator[] = [];
  const scopes: ReturnType<Orchestrator['createIntentScope']>[] = [];
  try {
    const instance = createRealtimeInstance(client, {
      createIntentScope: (orchestrator) => {
        owners.push(orchestrator);
        const scope = orchestrator.createIntentScope();
        scopes.push(scope);
        return scope;
      },
    });
    expect(owners).toEqual([]);
    const createScope = instance.createIntentScope;
    if (!createScope) throw new Error('missing scoped admission');

    expect(createScope()).toBe(scopes[0]);
    expect(createScope()).toBe(scopes[1]);
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(owners).toEqual([client, client]);
  } finally {
    await client.dispose();
  }
});

test('a custom scope preserves the original submission and its unknown outcome', async () => {
  const failure = new Error('transport outcome is unknown');
  const client = new Orchestrator(
    createMockConnector({
      process: async () => {
        throw failure;
      },
    }),
  );
  let original: IntentSubmission | undefined;
  try {
    await client.connect();
    const instance = createRealtimeInstance(client, {
      createIntentScope: (orchestrator) => {
        const scope = orchestrator.createIntentScope();
        return {
          enqueueIntent: (intent) => {
            original = scope.enqueueIntent(intent);
            return original;
          },
          retire: () => scope.retire(),
        };
      },
    });
    const scope = instance.createIntentScope?.();
    if (!scope) throw new Error('missing scoped admission');
    const submission = scope.enqueueIntent('uncertain change');
    if (!original) throw new Error('missing original submission');
    expect(submission).toBe(original);
    expect(submission.accepted).toBe(true);
    expect(submission.result).toBe(original.result);
    expect(await submission.result).toEqual({
      status: 'unknown',
      error: failure,
    });
    expect(submission.store.state.status).toBe('unknown');
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

  test('uses the configured agent route by default with no sendAgentMessage option', async () => {
    await withAgentOrchestrator(
      async ({ orchestrator, agent }) => {
        const instance = createRealtimeInstance(orchestrator);

        const outcome = requireSendAgentMessage(instance)('  show the board  ');
        await flush();
        expect(agent.inputs).toMatchObject([
          { type: 'utterance', text: 'show the board', source: 'voice' },
        ]);
        const firstInput = agent.inputs[0];
        if (!firstInput || firstInput.type !== 'utterance') {
          throw new Error('expected utterance input');
        }
        const inputId = firstInput.inputId;

        agent.emit(agentAcceptedEvent(inputId, runA, 'ui_only'));
        agent.emit(agentFinishedEvent(runA, { reply: 'Board is up' }));

        expect(await outcome).toMatchObject({
          inputId,
          status: 'finished',
          disposition: 'ui_only',
          reply: 'Board is up',
        });
      },
      { intentRoute: 'agent' },
    );
  });

  test('routes voice through orchestrator.submit on the configured single-request route', async () => {
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
      { intentRoute: 'single-request' },
    );
    try {
      await client.connect();
      const instance = createRealtimeInstance(client);
      expect('sendAgentMessage' in instance).toBe(false);
      const scope = instance.createIntentScope?.();
      if (!scope) throw new Error('missing scoped admission');

      const typed = client.submit('typed first', { source: 'text' });
      await flush();
      const spoken = scope.enqueueIntent('  spoken second  ');
      expect(spoken.store.state).toMatchObject({
        status: 'queued',
        queuePosition: 1,
      });

      release[0]({
        type: 'maelstrom_response',
        requestId: sent[0].id,
        userMessage: 'Applied',
        rationale: '',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      });
      expect((await typed.result).status).toBe('applied');
      await flush();
      expect(sent[1].request.context.updateReasons).toContainEqual({
        type: 'user_intent',
        intent: 'spoken second',
      });
      release[1]({
        type: 'maelstrom_response',
        requestId: sent[1].id,
        userMessage: 'Applied',
        rationale: '',
        executionPlan: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      });
      expect((await spoken.result).status).toBe('applied');
    } finally {
      await client.dispose();
    }
  });

  test('throws from a scoped enqueue on an agent-routed orchestrator without starting any agent submission', async () => {
    await withAgentOrchestrator(
      async ({ orchestrator, agent }) => {
        const scope =
          createRealtimeInstance(orchestrator).createIntentScope?.();
        if (!scope) throw new Error('expected createIntentScope');

        expect(() => scope.enqueueIntent('show the board')).toThrow(
          'Cannot enqueue single-request intent on an agent-routed orchestrator',
        );
        await flush();
        expect(agent.inputs).toEqual([]);
        expect(orchestrator.agent.store.state.runs).toEqual([]);
      },
      { intentRoute: 'agent' },
    );
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
