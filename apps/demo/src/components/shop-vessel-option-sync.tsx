import { useEffect } from 'react';
import { shop } from '../lib/pet-shop-maelstrom';
import { withActionOptions } from '../lib/vessel-options';
import { useCartStore } from '../vessels/cart.store';
import { cartVessel } from '../vessels/cart.vessel';
import { useOrdersStore } from '../vessels/orders.store';
import { ordersVessel } from '../vessels/orders.vessel';
import {
  cleanTitles,
  optionKey,
  republishWithRetry,
} from './vessel-option-sync';

/**
 * Renders nothing. The pet-shop counterpart of `VesselOptionSync`: publishes
 * real order ids and cart SKUs as action options on the shop instance.
 */
export function ShopVesselOptionSync() {
  const { orders } = useOrdersStore();
  const { lines } = useCartStore();
  const isProcessing = shop.useMaelstrom((s) => s.isProcessing);

  const orderIds = cleanTitles(
    orders.map((order) => order.id),
    'orders',
  );
  const cartSkus = cleanTitles(
    lines.map((line) => line.sku),
    'cart',
  );
  const orderKey = optionKey(orderIds);
  const cartKey = optionKey(cartSkus);

  useEffect(
    () =>
      republishWithRetry(() =>
        shop.updateVessel(
          withActionOptions(ordersVessel, {
            showOrderDetails: { orderId: orderIds },
          }),
        ),
      ),
    [orderKey, isProcessing],
  );

  // An empty cart publishes no enum, so the model still sees an
  // unconstrained sku rather than an impossible empty choice.
  useEffect(
    () =>
      republishWithRetry(() =>
        shop.updateVessel(
          withActionOptions(cartVessel, {
            removeFromCart: { sku: cartSkus },
            updateCartQuantity: { sku: cartSkus },
          }),
        ),
      ),
    [cartKey, isProcessing],
  );

  return null;
}
