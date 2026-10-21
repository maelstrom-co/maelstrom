import { ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../../components/vessel-card';
import { VESSEL_ACCENTS } from '../../lib/design-tokens';
import { shopM } from '../maelstrom';
import {
  cartActions,
  cartResultToAction,
  cartTotals,
  useCartStore,
} from '../stores/cart.store';
import { formatCents } from '../stores/fixtures';
import type { cartVessel } from './cart.vessel';
import { OrderTotalsTable } from './order-totals-table';

export default function CartComponent({
  instanceId,
  executeAction,
}: TypedVesselProps<typeof cartVessel>) {
  const { lines } = useCartStore();
  const totals = cartTotals(lines);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  shopM.useActions('cart', instanceId, {
    addToCart: async ({ sku, quantity }) => {
      const units = quantity ?? 1;
      return cartResultToAction(cartActions.addToCart(sku, units), {
        sku,
        quantity: units,
        quantityRule: 'a whole number of at least 1',
      });
    },
    removeFromCart: async ({ sku }) =>
      cartResultToAction(cartActions.removeFromCart(sku), { sku }),
    updateCartQuantity: async ({ sku, quantity }) =>
      cartResultToAction(cartActions.updateCartQuantity(sku, quantity), {
        sku,
        quantity,
        quantityRule: 'a whole number of 0 or more (0 removes the line)',
      }),
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
