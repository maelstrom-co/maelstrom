import { defineVessel } from '@maelstrom-co/protocol';
import {
  CATALOG_SKUS,
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  formatCents,
  TAX_RATE,
} from '../lib/pet-shop-fixtures';
import { withActionOptions } from '../lib/vessel-options';

const baseCartVessel = defineVessel({
  id: 'cart',
  name: 'Cart',
  description: `Shopping cart for the pet-food store. Shows each line item with quantity and price, plus subtotal, shipping (free at ${formatCents(FREE_SHIPPING_THRESHOLD_CENTS)} or more, otherwise ${formatCents(FLAT_SHIPPING_CENTS)}), ${TAX_RATE * 100}% tax and total. Use addToCart with a catalog SKU to put a product in the cart, then the checkout vessel to place the order.`,
  defaultVariant: 'items',
  variants: {
    items: {
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [
        {
          name: 'addToCart',
          description:
            'Add a catalog product to the cart. If the product is already in the cart its quantity increases by the given amount.',
          parameters: [
            {
              name: 'sku',
              type: 'string',
              description: 'SKU of the catalog product to add.',
            },
            {
              name: 'quantity',
              type: 'number',
              required: false,
              defaultValue: 1,
              description:
                'How many units to add, a whole number of at least 1. Defaults to 1.',
            },
          ],
        },
        {
          name: 'removeFromCart',
          description: 'Remove a product from the cart entirely.',
          parameters: [
            {
              name: 'sku',
              type: 'string',
              description: 'SKU of the cart line to remove.',
            },
          ],
        },
        {
          name: 'updateCartQuantity',
          idempotent: true,
          description:
            'Set the quantity of a product already in the cart. A quantity of 0 removes it.',
          parameters: [
            {
              name: 'sku',
              type: 'string',
              description: 'SKU of the cart line to change.',
            },
            {
              name: 'quantity',
              type: 'number',
              description: 'New quantity, a whole number; 0 removes the line.',
            },
          ],
        },
        {
          name: 'clearCart',
          idempotent: true,
          description: 'Remove every item from the cart.',
        },
      ],
    },
  },
});

export const cartVessel = withActionOptions(baseCartVessel, {
  addToCart: { sku: CATALOG_SKUS },
});
