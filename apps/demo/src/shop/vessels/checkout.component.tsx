import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';

import { VesselCard } from '../../components/vessel-card';
import { VESSEL_ACCENTS } from '../../lib/design-tokens';
import { shopM } from '../maelstrom';
import { cartTotals, useCartStore } from '../stores/cart.store';
import { checkoutActions, useCheckoutStore } from '../stores/checkout.store';
import { CUSTOMER, formatAddress } from '../stores/fixtures';
import type { checkoutVessel } from './checkout.vessel';
import { OrderTotalsTable } from './order-totals-table';

export default function CheckoutComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof checkoutVessel>) {
  const { lines } = useCartStore();
  const { lastConfirmation } = useCheckoutStore();

  shopM.useActions('checkout', instanceId, {
    placeOrder: async () => {
      if (!checkoutActions.placeOrder()) {
        return err(
          new Error(
            'The cart is empty. Add products with the cart vessel addToCart action before placing an order.',
          ),
        );
      }
      return ok(undefined);
    },
    returnToCheckoutReview: async () => {
      checkoutActions.returnToCheckoutReview();
      return ok(undefined);
    },
  });

  if (variantProps.variant === 'confirmation') {
    return (
      <VesselCard
        accent={VESSEL_ACCENTS.checkout}
        label="Checkout"
        meta="All set"
      >
        {lastConfirmation ? (
          <div className="flex-1 flex flex-col items-center gap-1 overflow-y-auto text-center">
            <div
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-green)] text-base font-bold text-white"
            >
              ✓
            </div>
            <div className="text-base font-bold text-[var(--color-ink)]">
              Order placed
            </div>
            <div className="text-[13px] text-[var(--color-ink-2)]">
              Order <span>{lastConfirmation.order.id}</span> on its way
            </div>
            <ul className="text-sm text-[var(--color-ink-2)] space-y-0.5">
              {lastConfirmation.order.items.map((item) => (
                <li key={item.sku}>
                  {item.quantity}× {item.name}
                </li>
              ))}
            </ul>
            <div className="text-xs text-[var(--color-ink-3)]">
              Ships to {lastConfirmation.shipTo}
            </div>
            <div className="text-xs text-[var(--color-ink-3)]">
              Demo order, nothing charged ({lastConfirmation.paymentMethod} on
              file)
            </div>
            <OrderTotalsTable totals={lastConfirmation.order.totals} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-ink-3)]">
            No order has been placed yet.
          </div>
        )}
        <button
          type="button"
          onClick={() => executeAction('returnToCheckoutReview')}
          className="self-start mt-2 text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          ← Back to checkout
        </button>
      </VesselCard>
    );
  }

  const visibleLines = lines.slice(0, MAX_VISIBLE_LINES);
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.checkout}
      label="Checkout"
      meta="Checkout"
    >
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        <section>
          <h3 className="text-xs font-bold text-[var(--color-ink-3)] mb-1">
            What's in the box
          </h3>
          {lines.length === 0 ? (
            <p className="text-sm text-[var(--color-ink-3)]">Cart is empty.</p>
          ) : (
            <ul className="text-sm text-[var(--color-ink-2)] space-y-0.5">
              {visibleLines.map((line) => (
                <li key={line.sku}>
                  {line.quantity}× {line.name}
                </li>
              ))}
              {hiddenCount > 0 && <li>and {hiddenCount} more</li>}
            </ul>
          )}
        </section>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <section>
            <h3 className="font-bold text-[var(--color-ink-3)] mb-1">
              Shipping to
            </h3>
            <p className="text-[var(--color-ink-2)]">
              {CUSTOMER.shippingAddress.name}
              <br />
              {formatAddress(CUSTOMER.shippingAddress)}
            </p>
          </section>
          <section>
            <h3 className="font-bold text-[var(--color-ink-3)] mb-1">
              Paying with
            </h3>
            <p className="text-[var(--color-ink-2)]">
              {CUSTOMER.paymentMethod.label}
            </p>
          </section>
        </div>
      </div>
      <OrderTotalsTable totals={cartTotals(lines)} />
      <button
        type="button"
        disabled={lines.length === 0}
        onClick={() => executeAction('placeOrder')}
        className="mt-3 w-full rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm font-bold text-white tabular-nums disabled:opacity-40"
      >
        Place order
      </button>
    </VesselCard>
  );
}

const MAX_VISIBLE_LINES = 2;
