import {
  type ChartRequest,
  type Vessel,
  type VesselDefinition,
  validateVessel,
} from '@maelstrom-co/protocol';

import { SHOP_LAYOUT } from '../src/shop/default-layout';
import { cartVessel } from '../src/shop/vessels/cart.vessel.def';
import { catalogVessel } from '../src/shop/vessels/catalog.vessel.def';
import { checkoutVessel } from '../src/shop/vessels/checkout.vessel.def';
import { ordersVessel } from '../src/shop/vessels/orders.vessel.def';

/** Which Chart `agent-utterance.ts` sends with its utterance. */
export interface UtteranceChartOptions {
  /** Send the pet shop Vessels and starting screen instead of an empty Chart. */
  readonly shop: boolean;
}

/**
 * Builds the `chart_request` the utterance script sends. The shop Chart
 * carries the same Vessels and starting layout the /shop page seeds, so a
 * loop-driven show has real Instances to target.
 */
export function buildUtteranceChart({
  shop,
}: UtteranceChartOptions): ChartRequest {
  const base = {
    type: 'chart_request',
    context: {
      updateReasons: [],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'tiling',
    },
  } as const;
  if (!shop) {
    return {
      ...base,
      instances: [],
      vessels: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    };
  }
  return {
    ...base,
    instances: SHOP_LAYOUT.instances,
    vessels: SHOP_VESSEL_DEFINITIONS.map(brandVessel),
    layout: SHOP_LAYOUT,
  };
}

const SHOP_VESSEL_DEFINITIONS: readonly VesselDefinition[] = [
  ordersVessel,
  catalogVessel,
  cartVessel,
  checkoutVessel,
];

function brandVessel(definition: VesselDefinition): Vessel {
  const result = validateVessel(definition);
  if (result.valid) return result.vessel;
  throw new Error(
    `vessel ${definition.id} failed validation: ${result.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')}`,
  );
}
