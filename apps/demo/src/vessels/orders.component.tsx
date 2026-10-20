import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { OrderTotalsTable } from '../components/order-totals-table';
import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import { formatCents, type Order } from '../lib/pet-shop-fixtures';
import { shop } from '../lib/pet-shop-maelstrom';
import {
  getOrdersSnapshot,
  ordersActions,
  useOrdersStore,
} from './orders.store';
import type { ordersVessel } from './orders.vessel';

export default function OrdersComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof ordersVessel>) {
  const { orders, selectedOrderId } = useOrdersStore();

  shop.useActions('orders', instanceId, {
    showOrderDetails: async ({ orderId }) => {
      if (!ordersActions.showOrderDetails(orderId)) {
        return err(noMatchError(orderId));
      }
      return ok(undefined);
    },
    showMostRecentOrder: async () => {
      if (!ordersActions.showMostRecentOrder()) {
        return err(new Error('The customer has no past orders.'));
      }
      return ok(undefined);
    },
    backToOrderList: async () => {
      ordersActions.backToOrderList();
      return ok(undefined);
    },
  });

  if (variantProps.variant === 'detail') {
    const order = orders.find((o) => o.id === selectedOrderId);
    return (
      <VesselCard
        accent={VESSEL_ACCENTS.orders}
        label="Orders"
        meta={order ? order.id : 'Detail'}
      >
        <button
          type="button"
          onClick={() => executeAction('backToOrderList')}
          className="self-start text-xs font-mono text-ink-3 hover:text-ink mb-2"
        >
          ← All orders
        </button>
        {order ? (
          <OrderDetail order={order} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <div className="text-sm text-ink">No order selected.</div>
            <div className="text-xs text-ink-3 max-w-xs">
              Ask to open an order by id, or the most recent one.
            </div>
          </div>
        )}
      </VesselCard>
    );
  }

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.orders}
      label="Orders"
      meta={`${orders.length} past`}
    >
      <div className="flex-1 space-y-2 overflow-y-auto">
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            onClick={() =>
              executeAction('showOrderDetails', { orderId: order.id })
            }
            className="w-full text-left rounded-md border border-white/5 px-3 py-2 hover:bg-white/5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-mono text-ink-2">{order.id}</span>
              <span className="text-xs font-mono text-ink-3">
                {order.placedOn}
              </span>
            </div>
            <div className="text-sm text-ink truncate">
              {order.items
                .map((item) => `${item.quantity}× ${item.name}`)
                .join(', ')}
            </div>
            <div className="flex justify-between text-xs text-ink-3">
              <span>{order.status}</span>
              <span className="font-mono">
                {formatCents(order.totals.totalCents)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </VesselCard>
  );
}

function OrderDetail({ order }: { order: Order }) {
  return (
    <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
      <div className="flex justify-between text-xs text-ink-3">
        <span>Placed {order.placedOn}</span>
        <span>{order.status}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-ink-3 text-left">
            <th className="font-normal pb-1">Item</th>
            <th className="font-normal pb-1 text-right">Qty</th>
            <th className="font-normal pb-1 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.sku} className="align-top">
              <td className="py-1 pr-2">
                <div className="text-ink">{item.name}</div>
                <div className="text-xs font-mono text-ink-3">{item.sku}</div>
              </td>
              <td className="py-1 text-right font-mono text-ink-2">
                {item.quantity}
              </td>
              <td className="py-1 text-right font-mono text-ink-2">
                {formatCents(item.unitPriceCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <OrderTotalsTable totals={order.totals} className="mt-auto" />
    </div>
  );
}

function noMatchError(orderId: string): Error {
  const available = getOrdersSnapshot()
    .orders.map((o) => o.id)
    .join(', ');
  return new Error(`No order matches "${orderId}". Available: ${available}`);
}
