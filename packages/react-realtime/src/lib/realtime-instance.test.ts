import { expect, test } from 'bun:test';
import { Orchestrator } from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createRealtimeInstance } from './realtime-instance.js';

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
