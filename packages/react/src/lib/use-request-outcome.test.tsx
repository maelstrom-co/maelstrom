import { afterEach, expect, it } from 'bun:test';

import type {
  IntentSubmission,
  Orchestrator,
  RequestOutcome,
} from '@maelstrom-co/client';
import {
  ActionName,
  type ChartRequestMessage,
  defineVessel,
  InstanceId,
  type MaelstromResponse,
  ok,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';

import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import type { MaelstromState } from './maelstrom-state-types.js';
import { vessel } from './vessel.js';

afterEach(cleanup);

const boardVessel = defineVessel({
  id: 'board',
  name: 'Board',
  description: 'Task board',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'setStatus', description: 'Set task status' }],
    },
  },
});

it('reports a typed and a voice request through processing to applied with the note', async () => {
  const sent: ChartRequestMessage[] = [];
  const pending: Array<(response: MaelstromResponse) => void> = [];
  const connector = createMockConnector({
    process: (request) => {
      sent.push(request);
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const respond = (index: number) =>
    pending[index]({
      type: 'maelstrom_response',
      requestId: sent[index].id,
      userMessage: 'Done',
      rationale: '',
      executionPlan: [
        { instanceId: InstanceId('board-1'), action: ActionName('setStatus') },
      ],
      layout: {
        type: 'tiling',
        tree: [],
        instances: [
          {
            instanceId: InstanceId('board-1'),
            vesselId: VesselId('board'),
            variant: VariantName('default'),
          },
        ],
      },
    });
  const m = createMaelstrom({
    vessels: [vessel(boardVessel, () => null)],
  }).with((context) => ({ useContext: context.useMaelstromContext }));
  let state!: MaelstromState;
  let client!: Orchestrator;
  let track!: (ticket: IntentSubmission | null) => void;
  const observed: {
    ticket: RequestOutcome | undefined;
    byId: RequestOutcome | undefined;
    latest: RequestOutcome | undefined;
  } = { ticket: undefined, byId: undefined, latest: undefined };
  function Probe() {
    state = m.useMaelstrom();
    client = m.useContext().orchestrator;
    const [ticket, setTicket] = useState<IntentSubmission | null>(null);
    track = setTicket;
    observed.ticket = m.useRequestOutcome(ticket);
    observed.byId = m.useRequestOutcome(ticket?.id);
    observed.latest = m.useLatestRequestOutcome();
    return null;
  }
  await act(async () => {
    render(
      <m.Provider connector={connector}>
        <Probe />
      </m.Provider>,
    );
  });
  expect(observed.ticket).toBeUndefined();
  expect(observed.latest).toBeUndefined();
  client.commandProcessor.registerRunner(InstanceId('board-1'), {
    setStatus: () => ok('12 tasks updated'),
  });

  let typed!: IntentSubmission;
  await act(async () => {
    typed = state.enqueueIntent('mark all done');
    track(typed);
  });
  expect(observed.ticket?.status).toBe('processing');
  expect(observed.byId).toBe(observed.ticket);
  expect(observed.latest?.id).toBe(typed.id);

  await act(async () => {
    respond(0);
    await typed.result;
  });
  const applied = {
    status: 'applied',
    actions: [
      {
        instanceId: InstanceId('board-1'),
        action: ActionName('setStatus'),
        status: 'ran',
        note: '12 tasks updated',
      },
    ],
  };
  expect(observed.ticket).toMatchObject({
    id: typed.id,
    intent: 'mark all done',
    ...applied,
  });
  expect(observed.latest).toBe(observed.ticket);

  let voice!: IntentSubmission;
  await act(async () => {
    voice = client.createIntentScope().enqueueIntent('mark all done again');
  });
  expect(observed.latest).toMatchObject({ id: voice.id });
  expect(observed.latest?.status).toBe('processing');
  await act(async () => {
    respond(1);
    await voice.result;
  });
  expect(observed.latest).toMatchObject({
    id: voice.id,
    intent: 'mark all done again',
    ...applied,
  });
  expect(observed.ticket?.id).toBe(typed.id);
});
