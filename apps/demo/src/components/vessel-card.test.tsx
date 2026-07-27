// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCENT_HEX } from '../lib/design-tokens';
import { VesselCard } from './vessel-card';

afterEach(cleanup);

describe('VesselCard', () => {
  it('renders label, meta, and children', () => {
    const { getByText } = render(
      <VesselCard accent="brand" label="Calendar" meta="This Week">
        <div>content</div>
      </VesselCard>,
    );
    expect(getByText('Calendar')).toBeTruthy();
    expect(getByText('This Week')).toBeTruthy();
    expect(getByText('content')).toBeTruthy();
  });

  it('omits the meta span when meta is not provided', () => {
    const { queryByText } = render(
      <VesselCard accent="brand" label="Calendar">
        <div>content</div>
      </VesselCard>,
    );
    expect(queryByText('This Week')).toBeNull();
  });

  it('sets --accent/--edge/--glow custom properties from the accent token', () => {
    const { container } = render(
      <VesselCard accent="amber" label="Tasks">
        <div>content</div>
      </VesselCard>,
    );
    const root = container.querySelector('.vessel-card') as HTMLElement;
    expect(root.style.getPropertyValue('--accent')).toBe(ACCENT_HEX.amber);
    expect(root.style.getPropertyValue('--edge')).toBe('#f5a52459');
    expect(root.style.getPropertyValue('--glow')).toBe('#f5a52438');
  });

  it("positions the header row so it stacks above a material layer like weather's sky-wash", () => {
    // sky-wash is position:absolute inset:0 z-index:0 inside .vessel-card, and
    // being positioned it paints after non-positioned siblings — so the
    // unpositioned header row would render underneath it. Giving the header
    // row its own `relative` (positioned, default z-index:auto which
    // resolves to 0 in the parent stacking context, after the DOM-earlier
    // sky-wash of the same computed z-index) lifts it into the positioned
    // paint layer, on top.
    const { getByText } = render(
      <VesselCard accent="brand-2" label="Weather" meta="72°">
        <div>content</div>
      </VesselCard>,
    );
    const headerRow = getByText('Weather').parentElement
      ?.parentElement as HTMLElement;
    expect(headerRow.className.split(' ')).toContain('relative');
  });
});
