import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { OrderTotalsTable } from '../components/order-totals-table';
import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import { CATALOG_SKUS, formatCents } from '../lib/pet-shop-fixtures';
import { shop } from '../lib/pet-shop-maelstrom';
import {
  type CartMutationResult,
  cartActions,
  cartTotals,
  getCartSnapshot,
  useCartStore,
} from './cart.store';
import type { cartVessel } from './cart.vessel';

export default function CartComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof cartVessel>) {
  const { lines } = useCartStore();
  const totals = cartTotals(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  shop.useActions('cart', instanceId, {
    addToCart: async ({ sku, quantity }) =>
      toActionResult(cartActions.addToCart(sku, quantity ?? 1), sku),
    removeFromCart: async ({ sku }) =>
      toActionResult(cartActions.removeFromCart(sku), sku),
    updateCartQuantity: async ({ sku, quantity }) =>
      toActionResult(cartActions.updateCartQuantity(sku, quantity), sku),
    clearCart: async () => {
      cartActions.clearCart();
      return ok(undefined);
    },
  });

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.cart}
      label="Cart"
      meta={`${itemCount} item${itemCount === 1 ? '' : 's'}`}
    >
      {lines.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
          <p className="text-sm text-ink-3">Your cart is empty</p>
          <p className="text-xs font-mono text-ink-3">
            Try: &ldquo;Add the healthy weight dog food to my cart&rdquo;
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {lines.map((line) => (
            <div key={line.sku} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink truncate">{line.name}</div>
                <div className="text-xs font-mono text-ink-3">
                  {line.sku} · {formatCents(line.unitPriceCents)} each
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs font-mono">
                <button
                  type="button"
                  aria-label={`Decrease ${line.name}`}
                  onClick={() =>
                    executeAction('updateCartQuantity', {
                      sku: line.sku,
                      quantity: line.quantity - 1,
                    })
                  }
                  className="px-1.5 rounded bg-white/5 hover:bg-white/10"
                >
                  −
                </button>
                <span className="w-5 text-center text-ink">
                  {line.quantity}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${line.name}`}
                  onClick={() =>
                    executeAction('updateCartQuantity', {
                      sku: line.sku,
                      quantity: line.quantity + 1,
                    })
                  }
                  className="px-1.5 rounded bg-white/5 hover:bg-white/10"
                >
                  +
                </button>
              </div>
              <div className="w-16 text-right text-sm font-mono text-ink-2">
                {formatCents(line.quantity * line.unitPriceCents)}
              </div>
            </div>
          ))}
        </div>
      )}
      <OrderTotalsTable totals={totals} />
    </VesselCard>
  );
}

function toActionResult(result: CartMutationResult, sku: string) {
  if (result.ok) return ok(undefined);
  switch (result.reason) {
    case 'unknown_product':
      return err(
        new Error(
          `No catalog product matches "${sku}". Available SKUs: ${CATALOG_SKUS.join(', ')}`,
        ),
      );
    case 'not_in_cart': {
      const inCart = getCartSnapshot()
        .lines.map((line) => line.sku)
        .join(', ');
      return err(
        new Error(
          `"${sku}" is not in the cart. Cart SKUs: ${inCart || '(cart is empty)'}`,
        ),
      );
    }
    case 'bad_quantity':
      return err(new Error('quantity must be a whole number of at least 1'));
  }
}
