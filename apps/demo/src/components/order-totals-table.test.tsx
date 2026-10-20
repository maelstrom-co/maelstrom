// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatCents, type OrderTotals } from '../lib/pet-shop-fixtures';
import { OrderTotalsTable } from './order-totals-table';

afterEach(cleanup);

describe('OrderTotalsTable', () => {
  it('shows flat shipping as a price below the free-shipping threshold', () => {
    const totals: OrderTotals = {
      subtotalCents: 2199,
      shippingCents: 599,
      taxCents: 176,
      totalCents: 2974,
    };
    const { getByText } = render(<OrderTotalsTable totals={totals} />);

    expect(rowValue(getByText('Subtotal'))).toBe(
      formatCents(totals.subtotalCents),
    );
    expect(rowValue(getByText('Shipping'))).toBe('$5.99');
    expect(rowValue(getByText('Tax'))).toBe(formatCents(totals.taxCents));
    expect(rowValue(getByText('Total'))).toBe(formatCents(totals.totalCents));
  });

  it('shows zero shipping as Free', () => {
    const totals: OrderTotals = {
      subtotalCents: 6699,
      shippingCents: 0,
      taxCents: 536,
      totalCents: 7235,
    };
    const { getByText } = render(<OrderTotalsTable totals={totals} />);

    expect(rowValue(getByText('Subtotal'))).toBe(
      formatCents(totals.subtotalCents),
    );
    expect(rowValue(getByText('Shipping'))).toBe('Free');
    expect(rowValue(getByText('Tax'))).toBe(formatCents(totals.taxCents));
    expect(rowValue(getByText('Total'))).toBe(formatCents(totals.totalCents));
  });
});

function rowValue(label: HTMLElement): string | null | undefined {
  return label.nextElementSibling?.textContent;
}
