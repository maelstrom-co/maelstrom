import { cn } from '../../lib/cn';
import { formatCents, type OrderTotals } from '../stores/fixtures';

interface OrderTotalsTableProps {
  totals: OrderTotals;
  className?: string;
}

export function OrderTotalsTable({ totals, className }: OrderTotalsTableProps) {
  return (
    <div
      className={cn(
        className ?? 'mt-3',
        'pt-2 border-t border-[var(--line)] text-xs text-[var(--color-ink-3)] space-y-0.5',
      )}
    >
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span className="tabular-nums">
          {formatCents(totals.subtotalCents)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Shipping</span>
        <span className="tabular-nums">
          {totals.shippingCents === 0
            ? 'Free'
            : formatCents(totals.shippingCents)}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Tax</span>
        <span className="tabular-nums">{formatCents(totals.taxCents)}</span>
      </div>
      <div className="flex justify-between text-sm font-semibold text-[var(--color-ink)]">
        <span>Total</span>
        <span className="tabular-nums">{formatCents(totals.totalCents)}</span>
      </div>
    </div>
  );
}
