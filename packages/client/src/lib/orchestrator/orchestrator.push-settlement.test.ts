import { afterEach, expect, it, mock } from 'bun:test';
import {
  type ChartRequestMessage,
  InstanceId,
  type MaelstromResponse,
  MessageId,
  ok,
  tilingLeafToken,
} from '@maelstrom-co/protocol';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { createMockConnector } from '../../../test-utils/connector-mocks.js';
import {
  createMockEmptyResponse,
  createMockResponse,
} from '../../../test-utils/mocks.js';
import type { ActionResult } from '../command-processor/action-result.js';
import type { ApplicationSettlement } from '../connection-manager/application-settlement.js';
import { Orchestrator } from './orchestrator.js';

const clients: Orchestrator[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.dispose();
});

it('captures request A before queued push P applies, then admits B with P as the current chart', async () => {
  let push!: (response: MaelstromResponse) => void;
  const action = Promise.withResolvers<ActionResult>();
  const acknowledgment = Promise.withResolvers<void>();
  const settlements: ApplicationSettlement[] = [];
  const requests: ChartRequestMessage[] = [];
  const connector = Object.assign(
    createMockConnector({
      process: async (message) => {
        requests.push(message);
        if (requests.length !== 1) return createMockEmptyResponse(message.id);
        const response = createMockResponse(message.id, 'active', 'show');
        return {
          ...response,
          layout: {
            ...response.layout,
            tree: [tilingLeafToken(InstanceId('active'))],
          },
        };
      },
      applicationSettled: async (value) => {
        settlements.push(value);
        if (settlements.length === 1) await acknowledgment.promise;
      },
    }),
    {
      onPushMessage(callback: typeof push) {
        push = callback;
        return () => {};
      },
    },
  );
  const client = new Orchestrator(connector);
  clients.push(client);
  await client.connect();
  client.commandProcessor.registerRunner(InstanceId('active'), {
    show: () => action.promise,
  });
  const first = client.enqueueIntent('A');
  await flushMicrotasks();
  const next = client.enqueueIntent('B');
  push(createMockEmptyResponse(MessageId('push-P')));
  action.resolve(ok(undefined));
  try {
    await flushMicrotasks();
    expect(settlements).toHaveLength(1);
    expect(settlements[0].requestId).toBe(requests[0].id);
    expect(
      settlements[0].chart.instances.map((instance) => instance.instanceId),
    ).toEqual([InstanceId('active')]);
    expect(client.getStructuralSnapshot().instances).toHaveLength(0);
    expect(requests).toHaveLength(1);
  } finally {
    acknowledgment.resolve();
  }
  expect((await first.result).status).toBe('applied');
  expect((await next.result).status).toBe('applied');
  expect(requests[1].request.instances).toHaveLength(0);
  expect(settlements).toHaveLength(2);
});

it('keeps unsolicited push delivery outside request acknowledgment and acknowledges admitted work exactly once', async () => {
  let push!: (response: MaelstromResponse) => void;
  const applicationSettled = mock(async () => {});
  const process = mock(async (request: ChartRequestMessage) =>
    createMockEmptyResponse(request.id),
  );
  const connector = Object.assign(
    createMockConnector({
      process,
      applicationSettled,
    }),
    {
      onPushMessage(callback: typeof push) {
        push = callback;
        return () => {};
      },
    },
  );
  const client = new Orchestrator(connector);
  clients.push(client);
  await client.connect();
  const completed: string[] = [];
  client.commandProcessor.events.on('command_complete', ({ command }) =>
    completed.push(command.kind),
  );
  push(createMockEmptyResponse(MessageId('voice-response')));
  await flushMicrotasks();
  expect(completed).toEqual(['set_layout', 'execute_actions']);
  expect(applicationSettled).not.toHaveBeenCalled();
  expect((await client.enqueueIntent('next').result).status).toBe('applied');
  expect(applicationSettled).toHaveBeenCalledTimes(1);
  expect(applicationSettled).toHaveBeenCalledWith(
    expect.objectContaining({
      requestId: process.mock.calls[0][0].id,
    }),
  );
});
