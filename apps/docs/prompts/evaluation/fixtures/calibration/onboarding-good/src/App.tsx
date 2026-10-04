import type { EngineConnector } from '@maelstrom-co/client';
import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import { createSimulatedConnector } from './testConnector';

const tickets = [
  { id: 'T-104', subject: 'Cannot update billing address', status: 'Open' },
  { id: 'T-105', subject: 'Export is missing a column', status: 'Waiting' },
];
const queue = defineVessel({
  id: 'support-queue',
  name: 'Support queue',
  description: 'Review support tickets.',
  defaultVariant: 'queue',
  variants: {
    queue: { props: {}, minSize: { width: 2, height: 2 }, actions: [] },
  },
});
function QueueVessel() {
  return (
    <ul aria-label="Support ticket queue">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          {ticket.subject} — {ticket.status}
        </li>
      ))}
    </ul>
  );
}
const maelstrom = createMaelstrom({ vessels: [vessel(queue, QueueVessel)] });
const simulated = createSimulatedConnector();
const connector: EngineConnector = {
  ...simulated,
  async process(message) {
    return {
      ...(await simulated.process(message)),
      layout: message.request.layout,
    };
  },
};
const initialLayout: TilingLayout = {
  type: 'tiling',
  tree: ['ID:queue-main'],
  instances: [
    {
      instanceId: InstanceId('queue-main'),
      vesselId: VesselId('support-queue'),
      variant: VariantName('queue'),
    },
  ],
};

export function App() {
  return (
    <maelstrom.Provider connector={connector} initialLayout={initialLayout}>
      <main style={{ height: 600 }}>
        <h1>Support workspace</h1>
        <p>Review the open support queue.</p>
        <maelstrom.Chart className="support-chart" style={{ height: 480 }} />
      </main>
    </maelstrom.Provider>
  );
}
