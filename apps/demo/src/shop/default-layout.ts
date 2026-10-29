import type { TilingLayout } from '@maelstrom-co/protocol';
import {
  InstanceId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

const ORDERS = InstanceId('orders-main');
const CART = InstanceId('cart-main');
const ORDERS_LEAF = tilingLeafToken(ORDERS);
const CART_LEAF = tilingLeafToken(CART);
const NARROW_CHART_HOST_WIDTH = 640;

/**
 * Starting screen for the shop instance: past orders beside the cart. The
 * catalog and checkout start off screen, so the Engine has to place them when
 * the user asks for them. A proposal, as with the home DEFAULT_LAYOUT: the
 * first chart request may resize or drop either tile.
 */
export const SHOP_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['V', ORDERS_LEAF, CART_LEAF],
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

/** The same starting screen stacked, orders above the cart, for a narrow chart host. */
export const SHOP_NARROW_LAYOUT: TilingLayout = {
  ...SHOP_LAYOUT,
  tree: ['H', ORDERS_LEAF, CART_LEAF],
};

/**
 * Picks the starting screen from the measured chart host width, never the
 * browser viewport. An unmeasured host gets the side-by-side screen.
 */
export function selectShopLayout(chartHostWidth: number | null): TilingLayout {
  return chartHostWidth !== null && chartHostWidth <= NARROW_CHART_HOST_WIDTH
    ? SHOP_NARROW_LAYOUT
    : SHOP_LAYOUT;
}
