import type { TilingLayout } from '@maelstrom-co/protocol';
import {
  InstanceId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

const CALENDAR = InstanceId('calendar-main');
const TASKS = InstanceId('tasks-main');
const CALENDAR_LEAF = tilingLeafToken(CALENDAR);
const TASKS_LEAF = tilingLeafToken(TASKS);

/**
 * The screen every visitor lands on: today's schedule beside the task list.
 * A proposal, not a contract — the first chart request carries the real
 * viewport, and the engine may resize or drop either tile to make it fit.
 */
export const DEFAULT_LAYOUT: TilingLayout = {
  type: 'tiling',
  // Preorder: 'V' splits the region left/right, its two children are leaves.
  tree: ['V', CALENDAR_LEAF, TASKS_LEAF],
  instances: [
    {
      instanceId: CALENDAR,
      vesselId: VesselId('calendar'),
      variant: VariantName('day'),
    },
    {
      instanceId: TASKS,
      vesselId: VesselId('tasks'),
      variant: VariantName('list'),
    },
  ],
};

export const NARROW_LAYOUT: TilingLayout = {
  ...DEFAULT_LAYOUT,
  tree: ['H', CALENDAR_LEAF, TASKS_LEAF],
};

const ORDERS = InstanceId('orders-main');
const CART = InstanceId('cart-main');

/**
 * The `/shop` starting screen: past orders beside the cart. The catalog and
 * checkout stay off screen so asking for them goes through the Planner.
 */
export const SHOP_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['V', tilingLeafToken(ORDERS), tilingLeafToken(CART)],
  instances: [
    {
      instanceId: ORDERS,
      vesselId: VesselId('orders'),
      variant: VariantName('list'),
    },
    {
      instanceId: CART,
      vesselId: VesselId('cart'),
      variant: VariantName('items'),
    },
  ],
};
