import { useEffect } from 'react';
import { withActionOptions } from '../lib/vessel-options';
import { shopM } from './maelstrom';
import { useCartStore } from './stores/cart.store';
import { useOrdersStore } from './stores/orders.store';
import {
  cleanOptionValues,
  optionKey,
  republishWithRetry,
} from './vessel-option-publishing';
import { cartVessel } from './vessels/cart.vessel';
import { ordersVessel } from './vessels/orders.vessel';

/**
 * Renders nothing. Keeps the order ids and cart SKUs the Engine and the voice
 * model choose from in step with the shop stores. Catalog SKUs are fixed, so
 * the Vessel definitions already carry them.
 */
export function ShopOptionSync() {
  const { orders } = useOrdersStore();
  const { lines } = useCartStore();
  const isProcessing = shopM.useMaelstrom((state) => state.isProcessing);

  const orderIds = cleanOptionValues(
    orders.map((order) => order.id),
    'orders',
  );
  const cartSkus = cleanOptionValues(
    lines.map((line) => line.sku),
    'cart',
  );
  const orderKey = optionKey(orderIds);
  const cartKey = optionKey(cartSkus);

  useEffect(
    () =>
      republishWithRetry(() =>
        shopM.updateVessel(
          withActionOptions(ordersVessel, {
            showOrderDetails: { orderId: orderIds },
          }),
        ),
      ),
    [orderKey, isProcessing],
  );

  // An empty cart publishes no enum, so the model sees an unconstrained sku
  // rather than an impossible empty choice.
  useEffect(
    () =>
      republishWithRetry(() =>
        shopM.updateVessel(
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
