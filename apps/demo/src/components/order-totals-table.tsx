import { cn } from '../lib/cn';
import { formatCents, type OrderTotals } from '../lib/pet-shop-fixtures';

interface OrderTotalsTableProps {
  totals: OrderTotals;
  className?: string;
}

export function OrderTotalsTable({ totals, className }: OrderTotalsTableProps) {
  return (
    <div
      className={cn(
        className ?? 'mt-3',
        'pt-2 border-t border-white/5 text-xs font-mono text-ink-3 space-y-0.5',
      )}
    >
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{formatCents(totals.subtotalCents)}</span>
      </div>
      <div className="flex justify-between">
        <span>Shipping</span>
        <span>
          {totals.shippingCents === 0
            ? 'Free'
            : formatCents(totals.shippingCents)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Tax</span>
        <span>{formatCents(totals.taxCents)}</span>
      </div>
      <div className="flex justify-between text-sm text-ink">
        <span>Total</span>
        <span>{formatCents(totals.totalCents)}</span>
      </div>
    </div>
  );
}
