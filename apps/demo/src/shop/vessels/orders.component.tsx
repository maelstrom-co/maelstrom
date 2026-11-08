import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';

import { VesselCard } from '../../components/vessel-card';
import { VESSEL_ACCENTS } from '../../lib/design-tokens';
import { shopM } from '../maelstrom';
import { ProductImage } from '../product-image';
import { formatCents, type Order, productBySku } from '../stores/fixtures';
import {
  getOrdersSnapshot,
  ordersActions,
  useOrdersStore,
} from '../stores/orders.store';
import { OrderTotalsTable } from './order-totals-table';
import type { ordersVessel } from './orders.vessel';

export default function OrdersComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof ordersVessel>) {
  const { orders, selectedOrderId } = useOrdersStore();

  shopM.useActions('orders', instanceId, {
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
        label="Your orders"
        meta={order ? order.id : 'Order details'}
      >
        <button
          type="button"
          onClick={() => executeAction('backToOrderList')}
          className="self-start text-xs text-ink-3 hover:text-ink mb-2"
        >
          ← All your orders
        </button>
        {order ? (
          <OrderDetail order={order} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <div className="text-sm text-ink">
              Pick an order to see what was in it.
            </div>
            <div className="text-xs text-ink-3 max-w-xs">
              Ask for your last order or one by number.
            </div>
          </div>
        )}
      </VesselCard>
    );
  }

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.orders}
      label="Your orders"
      meta={`${orders.length} past ${orders.length === 1 ? 'order' : 'orders'}`}
    >
      <div className="flex-1 space-y-2 overflow-y-auto">
        {orders.map((order) => (
          <button
            key={order.id}
            type="button"
            onClick={() =>
              executeAction('showOrderDetails', { orderId: order.id })
            }
            className="shop-row-hover w-full text-left rounded-[10px] bg-[var(--shop-chip-bg)] px-3 py-2 flex flex-col gap-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">
                Order {order.id} · {order.placedOn}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-ink-2 truncate min-w-0">
                {order.items
                  .map((item) => `${item.quantity}× ${item.name}`)
                  .join(', ')}
              </span>
              <span className="text-sm font-bold text-ink tabular-nums shrink-0">
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
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>Placed {order.placedOn}</span>
        <StatusBadge status={order.status} />
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-3 text-left">
              <th className="font-normal pb-1">Item</th>
              <th className="font-normal pb-1 pl-3 text-right">Qty</th>
              <th className="font-normal pb-1 pl-4 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.sku} className="align-middle">
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-2">
                    <ItemThumb sku={item.sku} />
                    <div className="min-w-0">
                      <div className="text-ink">{item.name}</div>
                      <div className="text-xs text-ink-3">{item.sku}</div>
                    </div>
                  </div>
                </td>
                <td className="py-1 pl-3 text-right tabular-nums text-ink-3 whitespace-nowrap">
                  ×{item.quantity}
                </td>
                <td className="py-1 pl-4 text-right tabular-nums text-ink-2 whitespace-nowrap">
                  {formatCents(item.unitPriceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <OrderTotalsTable totals={order.totals} className="shrink-0" />
    </div>
  );
}

const STATUS_DISPLAY = {
  delivered: {
    label: 'Delivered',
    style: {
      color: 'var(--color-green)',
      background: 'color-mix(in srgb, var(--color-green) 15%, transparent)',
    },
  },
  processing: {
    label: 'On its way',
    style: {
      color: 'var(--color-amber)',
      background: 'color-mix(in srgb, var(--color-amber) 18%, transparent)',
    },
  },
} as const;

function StatusBadge({ status }: { status: Order['status'] }) {
  const { label, style } = STATUS_DISPLAY[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold shrink-0"
      style={style}
    >
      {label}
    </span>
  );
}

function ItemThumb({ sku }: { sku: string }) {
  const product = productBySku(sku);
  if (!product) return null;
  return <ProductImage product={product} size="thumb" className="shrink-0" />;
}

function noMatchError(orderId: string): Error {
  const available = getOrdersSnapshot()
    .orders.map((o) => o.id)
    .join(', ');
  return new Error(`No order matches "${orderId}". Available: ${available}`);
}
