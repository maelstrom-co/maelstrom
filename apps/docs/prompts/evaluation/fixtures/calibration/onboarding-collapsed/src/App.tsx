import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import { createSimulatedConnector } from './testConnector';

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
    <ul>
      <li>T-104: Cannot update billing address</li>
      <li>T-105: Export is missing a column</li>
    </ul>
  );
}
const maelstrom = createMaelstrom({ vessels: [vessel(queue, QueueVessel)] });
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
    <maelstrom.Provider
      connector={createSimulatedConnector()}
      initialLayout={initialLayout}
    >
      <main>
        <h1>Support workspace</h1>
        <p>Review the open support queue.</p>
        <maelstrom.Chart style={{ height: 0 }} />
      </main>
    </maelstrom.Provider>
  );
}
