import { afterEach, describe, expect, it, mock } from 'bun:test';

import {
  ActionName,
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  ok,
  RunId,
} from '@maelstrom-co/protocol';

import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { createMockConnector } from '../../../test-utils/connector-mocks.js';
import {
  createMockEmptyResponse,
  createMockResponse,
  createMockResponseVessel,
} from '../../../test-utils/mocks.js';
import {
  agentAcceptedEvent,
  agentFinishedEvent,
  createMockAgentConnector,
} from '../__test-helpers__/agent-connector-mock.js';
import { AgentWireUnsupportedError } from '../connection-manager/connector.types.js';
import { Orchestrator } from './orchestrator.js';
import type { IntentRoute } from './submit-intent.types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('Orchestrator.submit', () => {
  const clients: Orchestrator[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.dispose();
  });

  it('defaults intentRoute to single-request and rejects unknown values at construction', () => {
    const client = new Orchestrator(createMockConnector());
    clients.push(client);
    expect(client.getConfig().intentRoute).toBe('single-request');

    expect(
      () =>
        new Orchestrator(createMockConnector(), {
          intentRoute: 'bogus' as IntentRoute,
        }),
    ).toThrow(/intentRoute must be "single-request" or "agent"/);
  });

  it('records a request outcome for typed and spoken intents submitted on the single-request route', async () => {
    const sent: ChartRequestMessage[] = [];
    const responses: ReturnType<typeof deferred<MaelstromResponse>>[] = [];
    const connector = createMockConnector({
      process: mock((request: ChartRequestMessage) => {
        sent.push(request);
        const pending = deferred<MaelstromResponse>();
        responses.push(pending);
        return pending.promise;
      }),
    });
    const client = new Orchestrator(connector, {
      vessels: [createMockResponseVessel('setStatus')],
    });
    clients.push(client);
    await client.connect();
    let runs = 0;
    client.commandProcessor.registerRunner(InstanceId('board'), {
      setStatus: () => ok(`run ${++runs}`),
    });
    const outcomes = () => client.requestOutcomes.store.state;

    const typed = client.submit('  mark it done  ');
    const spoken = client.submit('mark it done again', {
      source: 'voice',
      scope: client.createIntentScope(),
    });
    if (typed.route !== 'single-request' || spoken.route !== 'single-request')
      throw new Error('expected the single-request route');
    expect(outcomes().outcomes[typed.submission.id]).toMatchObject({
      id: typed.submission.id,
      intent: 'mark it done',
      actions: [],
    });
    expect(outcomes().outcomes[spoken.submission.id]).toMatchObject({
      intent: 'mark it done again',
      status: 'queued',
    });
    expect(outcomes().latestId).toBe(spoken.submission.id);

    await flushMicrotasks();
    responses[0]!.resolve(
      createMockResponse(sent[0]!.id, 'board', 'setStatus'),
    );
    expect((await typed.result).status).toBe('applied');
    await flushMicrotasks();
    responses[1]!.resolve(
      createMockResponse(sent[1]!.id, 'board', 'setStatus'),
    );
    expect((await spoken.result).status).toBe('applied');

    const ran = (value: string) => ({
      status: 'applied',
      actions: [
        {
          instanceId: InstanceId('board'),
          action: ActionName('setStatus'),
          status: 'ran',
          value,
        },
      ],
    });
    expect(outcomes().outcomes[typed.submission.id]).toMatchObject(
      ran('run 1'),
    );
    expect(outcomes().outcomes[spoken.submission.id]).toMatchObject(
      ran('run 2'),
    );
  });

  it('records no request outcome for an intent submitted on the agent route', async () => {
    const agent = createMockAgentConnector();
    const client = new Orchestrator(agent.connector, { intentRoute: 'agent' });
    clients.push(client);
    await client.connect();

    const submitted = client.submit('ask the agent');
    expect(submitted.route).toBe('agent');
    await flushMicrotasks();
    expect(client.requestOutcomes.store.state).toEqual({
      outcomes: {},
      latestId: null,
    });
  });

  it('shares one FIFO queue across text and voice sources on the single-request route', async () => {
    const sent: ChartRequestMessage[] = [];
    const responses: ReturnType<typeof deferred<MaelstromResponse>>[] = [];
    const connector = createMockConnector({
      process: mock((request: ChartRequestMessage) => {
        sent.push(request);
        const pending = deferred<MaelstromResponse>();
        responses.push(pending);
        return pending.promise;
      }),
    });
    const client = new Orchestrator(connector, {
      intentRoute: 'single-request',
    });
    clients.push(client);
    await client.connect();

    const voiceScope = client.createIntentScope();
    const first = client.submit('  first typed  ', { source: 'text' });
    await flushMicrotasks();
    const second = client.submit('  second voice  ', {
      source: 'voice',
      scope: voiceScope,
    });
    const third = client.submit('third typed');
    const retiredVoice = client.submit('retired voice', {
      source: 'voice',
      scope: voiceScope,
    });

    expect(first.route).toBe('single-request');
    expect(second.route).toBe('single-request');
    expect(third.route).toBe('single-request');
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(third.accepted).toBe(true);
    expect(
      second.route === 'single-request' && second.submission.store.state,
    ).toEqual({
      status: 'queued',
      queuePosition: 1,
    });
    expect(
      third.route === 'single-request' && third.submission.store.state,
    ).toEqual({
      status: 'queued',
      queuePosition: 2,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'first typed',
    });

    responses[0].resolve(createMockEmptyResponse(sent[0].id));
    expect((await first.result).status).toBe('applied');
    await flushMicrotasks();

    expect(sent).toHaveLength(2);
    expect(sent[1].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'second voice',
    });

    // Retiring the voice scope cancels only pending voice work, preserving active voice and typed work.
    voiceScope.retire();
    expect(await retiredVoice.result).toEqual({
      status: 'not_submitted',
      reason: 'owner_retired',
    });

    responses[1].resolve(createMockEmptyResponse(sent[1].id));
    expect((await second.result).status).toBe('applied');
    await flushMicrotasks();

    expect(sent).toHaveLength(3);
    expect(sent[2].request.context.updateReasons).toContainEqual({
      type: 'user_intent',
      intent: 'third typed',
    });
    responses[2].resolve(createMockEmptyResponse(sent[2].id));
    expect((await third.result).status).toBe('applied');
  });

  it('refuses synchronously with accepted=false when the single-request queue is full', async () => {
    const connector = createMockConnector({
      process: () => new Promise<MaelstromResponse>(() => {}),
    });
    const client = new Orchestrator(connector, {
      intentRoute: 'single-request',
      intentQueue: { capacity: 1 },
    });
    clients.push(client);
    await client.connect();

    const active = client.submit('active', { source: 'text' });
    await flushMicrotasks();
    const queued = client.submit('queued', { source: 'voice' });
    const refused = client.submit('refused', { source: 'text' });

    expect(active.accepted).toBe(true);
    expect(queued.accepted).toBe(true);
    expect(refused.accepted).toBe(false);
    expect(await refused.result).toEqual({
      status: 'not_submitted',
      reason: 'queue_full',
    });
  });

  it('shares one agent conversation across text and voice sources on the agent route', async () => {
    const agent = createMockAgentConnector();
    const client = new Orchestrator(agent.connector, {
      intentRoute: 'agent',
    });
    clients.push(client);
    await client.connect();

    const typed = client.submit('  show my orders  ', { source: 'text' });
    const spoken = client.submit('  show the catalog  ', { source: 'voice' });

    expect(typed.route).toBe('agent');
    expect(spoken.route).toBe('agent');
    expect(typed.accepted).toBe(true);
    expect(spoken.accepted).toBe(true);
    await flushMicrotasks();

    expect(agent.inputs).toMatchObject([
      { type: 'utterance', text: 'show my orders', source: 'text' },
      { type: 'utterance', text: 'show the catalog', source: 'voice' },
    ]);
    if (typed.route !== 'agent' || spoken.route !== 'agent') {
      throw new Error('expected agent route');
    }
    expect(client.agent.store.state.runs.map((run) => run.inputId)).toEqual([
      typed.submission.inputId,
      spoken.submission.inputId,
    ]);

    const run1 = RunId('run-1');
    const run2 = RunId('run-2');
    agent.emit(agentAcceptedEvent(typed.submission.inputId, run1, 'ui_only'));
    agent.emit(agentFinishedEvent(run1, { reply: 'Orders shown' }));
    agent.emit(agentAcceptedEvent(spoken.submission.inputId, run2, 'ui_only'));
    agent.emit(agentFinishedEvent(run2, { reply: 'Catalog shown' }));

    expect(await typed.result).toMatchObject({
      status: 'finished',
      reply: 'Orders shown',
    });
    expect(await spoken.result).toMatchObject({
      status: 'finished',
      reply: 'Catalog shown',
    });
  });

  it('reports accepted=false and not_submitted on the agent route when disconnected', async () => {
    const agent = createMockAgentConnector();
    const client = new Orchestrator(agent.connector, {
      intentRoute: 'agent',
    });
    clients.push(client);

    const refused = client.submit('hello', { source: 'text' });
    expect(refused.route).toBe('agent');
    expect(refused.accepted).toBe(false);
    expect(await refused.result).toMatchObject({
      status: 'not_submitted',
      error: { message: 'Orchestrator is not connected' },
    });
    expect(agent.inputs).toEqual([]);
  });

  it('reports accepted=true and later settles not_submitted when a connected connector cannot carry agent inputs', async () => {
    const agent = createMockAgentConnector({
      sendInput: () =>
        Promise.reject(new AgentWireUnsupportedError('agent wire unsupported')),
    });
    const client = new Orchestrator(agent.connector, {
      intentRoute: 'agent',
    });
    clients.push(client);
    await client.connect();

    const submitted = client.submit('hello', { source: 'text' });
    expect(submitted.route).toBe('agent');
    expect(submitted.accepted).toBe(true);
    expect(await submitted.result).toMatchObject({
      status: 'not_submitted',
      error: { message: 'agent wire unsupported' },
    });
  });
});
