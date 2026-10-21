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
        meta="Confirmed"
      >
        {lastConfirmation ? (
          <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
            <div className="text-base text-ink">Order placed</div>
            <div className="text-sm font-mono text-ink-2">
              {lastConfirmation.order.id}
            </div>
            <ul className="text-sm text-ink-2 space-y-0.5">
              {lastConfirmation.order.items.map((item) => (
                <li key={item.sku}>
                  {item.quantity}× {item.name}
                </li>
              ))}
            </ul>
            <div className="text-xs text-ink-3">
              Ships to {lastConfirmation.shipTo}
            </div>
            <div className="text-xs text-ink-3">
              Demo order, nothing charged ({lastConfirmation.paymentMethod} on
              file)
            </div>
            <OrderTotalsTable totals={lastConfirmation.order.totals} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-ink-3">
            No order has been placed yet.
          </div>
        )}
        <button
          type="button"
          onClick={() => executeAction('returnToCheckoutReview')}
          className="self-start mt-2 text-xs font-mono text-ink-3 hover:text-ink"
        >
          ← Back to checkout
        </button>
      </VesselCard>
    );
  }

  return (
    <VesselCard accent={VESSEL_ACCENTS.checkout} label="Checkout" meta="Review">
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        <section>
          <h3 className="text-xs text-ink-3 mb-1">Items</h3>
          {lines.length === 0 ? (
            <p className="text-sm text-ink-3">Cart is empty.</p>
          ) : (
            <ul className="text-sm text-ink-2 space-y-0.5">
              {lines.map((line) => (
                <li key={line.sku}>
                  {line.quantity}× {line.name}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-xs text-ink-3 mb-1">Ship to</h3>
          <p className="text-sm text-ink-2">
            {CUSTOMER.shippingAddress.name}
            <br />
            {formatAddress(CUSTOMER.shippingAddress)}
          </p>
        </section>
        <section>
          <h3 className="text-xs text-ink-3 mb-1">Payment</h3>
          <p className="text-sm text-ink-2">{CUSTOMER.paymentMethod.label}</p>
        </section>
      </div>
      <OrderTotalsTable totals={cartTotals(lines)} />
      <button
        type="button"
        disabled={lines.length === 0}
        onClick={() => executeAction('placeOrder')}
        className="mt-3 rounded-md bg-white/10 px-3 py-2 text-sm text-ink hover:bg-white/15 disabled:opacity-40"
      >
        Place order
      </button>
    </VesselCard>
  );
}
