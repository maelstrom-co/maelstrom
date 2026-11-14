import { describe, expect, test } from 'vitest';

import { SHOP_LAYOUT } from '../src/shop/default-layout';
import { buildUtteranceChart } from './agent-utterance-chart';

describe('buildUtteranceChart', () => {
  test('sends an empty screen by default', () => {
    const chart = buildUtteranceChart({ shop: false });

    expect(chart.vessels).toEqual([]);
    expect(chart.instances).toEqual([]);
    expect(chart.layout).toEqual({ type: 'tiling', tree: [], instances: [] });
  });

  test('sends the pet shop vessels and starting screen with the shop flag', () => {
    const chart = buildUtteranceChart({ shop: true });

    expect(chart.vessels.map((vessel) => vessel.id)).toEqual([
      'orders',
      'catalog',
      'cart',
      'checkout',
    ]);
    expect(chart.layout).toEqual(SHOP_LAYOUT);
    expect(chart.instances).toEqual(SHOP_LAYOUT.instances);
  });
});
