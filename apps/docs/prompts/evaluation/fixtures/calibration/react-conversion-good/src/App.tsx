import type { EngineConnector } from '@maelstrom-co/client';
import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import { SearchPanel } from './SearchPanel';
import { createSimulatedConnector } from './testConnector';

const search = defineVessel({
  id: 'ticket-search',
  name: 'Ticket search',
  description: 'Search support tickets.',
  defaultVariant: 'search',
  variants: {
    search: { props: {}, minSize: { width: 2, height: 2 }, actions: [] },
  },
});
function SearchVessel() {
  return <SearchPanel />;
}
const maelstrom = createMaelstrom({ vessels: [vessel(search, SearchVessel)] });
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
  tree: ['ID:search-main'],
  instances: [
    {
      instanceId: InstanceId('search-main'),
      vesselId: VesselId('ticket-search'),
      variant: VariantName('search'),
    },
  ],
};

export function App() {
  return (
    <maelstrom.Provider connector={connector} initialLayout={initialLayout}>
      <main style={{ height: 600 }}>
        <h1>Support workspace</h1>
        <p>Search support tickets.</p>
        <maelstrom.Chart className="support-chart" style={{ height: 480 }} />
      </main>
    </maelstrom.Provider>
  );
}
