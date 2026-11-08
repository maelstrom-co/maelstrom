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
        'pt-2 border-t border-[var(--line)] text-xs text-[var(--color-ink-3)] space-y-0.5 tabular-nums',
      )}
    >
      <TotalsRow label="Subtotal" value={formatCents(totals.subtotalCents)} />
      <TotalsRow
        label="Shipping"
        value={
          totals.shippingCents === 0
            ? 'Free'
            : formatCents(totals.shippingCents)
        }
      />
      <TotalsRow label="Tax" value={formatCents(totals.taxCents)} />
      <TotalsRow label="Total" value={formatCents(totals.totalCents)} strong />
    </div>
  );
}

function TotalsRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] gap-x-4',
        strong && 'text-sm font-bold text-[var(--color-ink)]',
      )}
    >
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
