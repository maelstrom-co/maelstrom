import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  ActionName,
  type ActionExecution,
  type ChartRequestMessage,
  err,
  InstanceId,
  type MaelstromResponse,
  type MessageId,
  ok,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { createMockConnector } from '../../../test-utils/connector-mocks.js';
import {
  createMockResponse,
  createMockResponseVessel,
} from '../../../test-utils/mocks.js';
import type { ActionResult } from '../command-processor/action-result.js';
import type { IntentSubmission } from './intent-scheduler.types.js';
import { Orchestrator } from './orchestrator.js';
import type { OrchestratorOptions } from './orchestrator.types.js';
import {
  REQUEST_OUTCOME_RETENTION,
  type RequestOutcome,
} from './request-outcome.types.js';

describe('Orchestrator request outcomes', () => {
  let clock: ReturnType<typeof FakeTimers.install>;
  const clients: Orchestrator[] = [];
  beforeEach(() => {
    clock = FakeTimers.install();
  });
  afterEach(async () => {
    for (const client of clients.splice(0)) await client.dispose();
    clock.uninstall();
  });

  async function setup(actions: string[], options: OrchestratorOptions = {}) {
    const sent: ChartRequestMessage[] = [];
    const responses: ReturnType<typeof deferred<MaelstromResponse>>[] = [];
    const connector = createMockConnector({
      process: mock((request: ChartRequestMessage) => {
        sent.push(request);
        const response = deferred<MaelstromResponse>();
        responses.push(response);
        return response.promise;
      }),
    });
    const client = new Orchestrator(connector, {
      vessels: [createMockResponseVessel(...actions)],
      ...options,
    });
    clients.push(client);
    await client.connect();
    const outcomeOf = (ticket: IntentSubmission): RequestOutcome | undefined =>
      client.requestOutcomes.store.state.outcomes[ticket.id];
    return { client, sent, responses, outcomeOf };
  }

  it('reports one setStatus Action with its note once the batch applies', async () => {
    const { client, sent, responses, outcomeOf } = await setup(['setStatus']);
    client.commandProcessor.registerRunner(InstanceId('board'), {
      setStatus: () => ok('12 tasks updated'),
    });
    const ticket = client.enqueueIntent('mark everything done');
    expect(outcomeOf(ticket)).toMatchObject({
      id: ticket.id,
      intent: 'mark everything done',
      actions: [],
    });
    expect(client.requestOutcomes.store.state.latestId).toBe(ticket.id);
    await flushMicrotasks();
    expect(outcomeOf(ticket)?.status).toBe('processing');

    responses[0].resolve(createMockResponse(sent[0].id, 'board', 'setStatus'));
    expect((await ticket.result).status).toBe('applied');
    expect(outcomeOf(ticket)).toEqual({
      id: ticket.id,
      intent: 'mark everything done',
      status: 'applied',
      actions: [
        {
          instanceId: InstanceId('board'),
          action: ActionName('setStatus'),
          status: 'ran',
          note: '12 tasks updated',
        },
      ],
    });
  });

  it('reports a mixed batch with ran, failed and skipped Actions as unknown', async () => {
    const { client, sent, responses, outcomeOf } = await setup(
      ['show', 'fail'],
      { readyTimeoutMs: 10 },
    );
    client.commandProcessor.registerRunner(InstanceId('a'), {
      show: () => ok('opened'),
    });
    client.commandProcessor.registerRunner(InstanceId('b'), {
      fail: () => err(new Error('backend refused')),
    });
    const ticket = client.enqueueIntent('mixed');
    await flushMicrotasks();
    responses[0].resolve(
      responseWith(sent[0].id, [
        step('a', 'show'),
        step('b', 'fail'),
        step('missing', 'show'),
      ]),
    );
    await flushMicrotasks();
    expect(outcomeOf(ticket)?.actions.map((a) => a.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ]);
    await clock.tickAsync(10);
    const result = await ticket.result;

    expect(result.status).toBe('unknown');
    expect(outcomeOf(ticket)).toMatchObject({
      status: 'unknown',
      error: expect.any(Error),
      actions: [
        { instanceId: 'a', action: 'show', status: 'ran', note: 'opened' },
        {
          instanceId: 'b',
          action: 'fail',
          status: 'failed',
          reason: 'backend refused',
        },
        {
          instanceId: 'missing',
          action: 'show',
          status: 'skipped',
          reason: 'readiness',
        },
      ],
    });
  });

  it('keeps each Instance in plan order with its own notes', async () => {
    const { client, sent, responses, outcomeOf } = await setup([
      'first',
      'middle',
      'second',
    ]);
    const calls: string[] = [];
    client.commandProcessor.registerRunner(InstanceId('a'), {
      first: () => {
        calls.push('a.first');
        return ok('first note');
      },
      second: () => {
        calls.push('a.second');
        return ok('second note');
      },
    });
    client.commandProcessor.registerRunner(InstanceId('b'), {
      middle: () => {
        calls.push('b.middle');
        return ok(undefined);
      },
    });
    const ticket = client.enqueueIntent('ordered');
    await flushMicrotasks();
    responses[0].resolve(
      responseWith(sent[0].id, [
        step('a', 'first'),
        step('b', 'middle'),
        step('a', 'second'),
      ]),
    );
    expect((await ticket.result).status).toBe('applied');

    expect(calls.indexOf('a.first')).toBeLessThan(calls.indexOf('a.second'));
    expect(outcomeOf(ticket)?.actions).toEqual([
      {
        instanceId: InstanceId('a'),
        action: ActionName('first'),
        status: 'ran',
        note: 'first note',
      },
      {
        instanceId: InstanceId('b'),
        action: ActionName('middle'),
        status: 'ran',
      },
      {
        instanceId: InstanceId('a'),
        action: ActionName('second'),
        status: 'ran',
        note: 'second note',
      },
    ]);
  });

  it('reports a disposed batch as unknown, never failed or not submitted', async () => {
    const { client, sent, responses, outcomeOf } = await setup(['show']);
    const hanging = deferred<ActionResult>();
    client.commandProcessor.registerRunner(InstanceId('a'), {
      show: () => ok('quick'),
    });
    client.commandProcessor.registerRunner(InstanceId('b'), {
      show: () => hanging.promise,
    });
    const ticket = client.enqueueIntent('abandoned');
    await flushMicrotasks();
    responses[0].resolve(
      responseWith(sent[0].id, [step('a', 'show'), step('b', 'show')]),
    );
    await flushMicrotasks();
    await client.dispose();

    expect((await ticket.result).status).toBe('unknown');
    expect(outcomeOf(ticket)).toMatchObject({
      status: 'unknown',
      error: expect.any(Error),
      actions: [
        { instanceId: 'a', action: 'show', status: 'unknown' },
        { instanceId: 'b', action: 'show', status: 'unknown' },
      ],
    });
    expect(outcomeOf(ticket)?.reason).toBeUndefined();
  });

  it('reports a transport failure as unknown with no planned Actions', async () => {
    const { client, responses, outcomeOf } = await setup(['show']);
    const ticket = client.enqueueIntent('lost');
    await flushMicrotasks();
    const error = new Error('socket closed');
    responses[0].reject(error);
    await ticket.result;

    expect(outcomeOf(ticket)).toEqual({
      id: ticket.id,
      intent: 'lost',
      status: 'unknown',
      actions: [],
      error,
    });
  });

  it('reports a layout refusal as failed with every planned Action skipped', async () => {
    const { client, sent, responses, outcomeOf } = await setup(['show']);
    const ticket = client.enqueueIntent('refused');
    await flushMicrotasks();
    const response = createMockResponse(sent[0].id, 'a', 'show');
    if (response.layout.type !== 'tiling')
      throw new Error('expected tiling fixture');
    const duplicateLeaf = tilingLeafToken(InstanceId('a'));
    responses[0].resolve({
      ...response,
      layout: { ...response.layout, tree: ['V', duplicateLeaf, duplicateLeaf] },
    });
    expect((await ticket.result).status).toBe('failed');

    const outcome = outcomeOf(ticket);
    expect(outcome?.status).toBe('failed');
    expect(outcome?.actions).toEqual([
      {
        instanceId: InstanceId('a'),
        action: ActionName('show'),
        status: 'skipped',
        reason: outcome?.error?.message ?? '',
      },
    ]);
  });

  it('never includes manual Action clicks made while the request is in flight', async () => {
    const { client, sent, responses, outcomeOf } = await setup([
      'show',
      'toggle',
    ]);
    const planned = deferred<ActionResult>();
    client.commandProcessor.registerRunner(InstanceId('a'), {
      show: () => planned.promise,
      toggle: () => ok('manual note'),
    });
    const ticket = client.enqueueIntent('show a');
    await flushMicrotasks();
    expect(
      await client.commandProcessor.runLocalAction(step('a', 'toggle')),
    ).toBe('succeeded');

    responses[0].resolve(createMockResponse(sent[0].id, 'a', 'show'));
    await flushMicrotasks();
    const queuedClick = client.commandProcessor.runLocalAction(
      step('a', 'toggle'),
    );
    planned.resolve(ok('planned note'));
    expect((await ticket.result).status).toBe('applied');
    expect(await queuedClick).toBe('succeeded');

    expect(outcomeOf(ticket)?.actions).toEqual([
      {
        instanceId: InstanceId('a'),
        action: ActionName('show'),
        status: 'ran',
        note: 'planned note',
      },
    ]);
  });

  it('records voice submissions through an intent scope with the same shape', async () => {
    const { client, sent, responses, outcomeOf } = await setup(['setStatus']);
    client.commandProcessor.registerRunner(InstanceId('board'), {
      setStatus: () => ok('3 tasks updated'),
    });
    const scope = client.createIntentScope();
    const voice = scope.enqueueIntent('mark three done');
    const typed = client.enqueueIntent('mark three done');
    expect(client.requestOutcomes.store.state.latestId).toBe(typed.id);
    await flushMicrotasks();
    responses[0].resolve(createMockResponse(sent[0].id, 'board', 'setStatus'));
    await voice.result;
    await flushMicrotasks();
    responses[1].resolve(createMockResponse(sent[1].id, 'board', 'setStatus'));
    await typed.result;

    const { id: voiceId, ...voiceShape } = outcomeOf(voice) ?? {};
    const { id: typedId, ...typedShape } = outcomeOf(typed) ?? {};
    expect(voiceId).toBe(voice.id);
    expect(typedId).toBe(typed.id);
    expect(voiceShape).toEqual(typedShape);
    expect(voiceShape).toMatchObject({
      status: 'applied',
      actions: [{ status: 'ran', note: '3 tasks updated' }],
    });
  });

  it('records immediate refusals as not submitted without becoming latest', async () => {
    const { client, outcomeOf } = await setup(['show'], {
      intentQueue: { capacity: 1 },
    });
    client.commandProcessor.registerRunner(InstanceId('a'), {
      show: () => ok(undefined),
    });
    const active = client.enqueueIntent('active');
    await flushMicrotasks();
    const pending = client.enqueueIntent('pending');
    const refused = client.enqueueIntent('refused');

    expect(outcomeOf(refused)).toEqual({
      id: refused.id,
      intent: 'refused',
      status: 'not_submitted',
      actions: [],
      reason: 'queue_full',
    });
    expect(outcomeOf(pending)?.status).toBe('queued');
    expect(outcomeOf(active)?.status).toBe('processing');
    expect(client.requestOutcomes.store.state.latestId).toBe(pending.id);
  });

  it(`retains only the ${REQUEST_OUTCOME_RETENTION} most recently admitted requests`, async () => {
    const { client } = await setup(['show']);
    await client.dispose();
    const tickets = Array.from(
      { length: REQUEST_OUTCOME_RETENTION + 2 },
      (_, index) => client.enqueueIntent(`intent ${index}`),
    );
    const { outcomes } = client.requestOutcomes.store.state;

    expect(Object.keys(outcomes)).toHaveLength(REQUEST_OUTCOME_RETENTION);
    expect(outcomes[tickets[0].id]).toBeUndefined();
    expect(outcomes[tickets[1].id]).toBeUndefined();
    expect(outcomes[tickets[2].id]?.reason).toBe('disposed');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function step(instanceId: string, action: string): ActionExecution {
  return { instanceId: InstanceId(instanceId), action: ActionName(action) };
}

function responseWith(
  requestId: MessageId,
  executionPlan: ActionExecution[],
): MaelstromResponse {
  const instanceIds = [...new Set(executionPlan.map((s) => s.instanceId))];
  return {
    type: 'maelstrom_response',
    requestId,
    userMessage: 'ok',
    rationale: 'test',
    executionPlan,
    layout: {
      type: 'tiling',
      tree: [],
      instances: instanceIds.map((instanceId) => ({
        instanceId,
        vesselId: VesselId('vessel-1'),
        variant: VariantName('default'),
      })),
    },
  };
}
