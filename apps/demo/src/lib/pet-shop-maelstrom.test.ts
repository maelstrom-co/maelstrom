import { describe, expect, it } from 'vitest';
import { shop } from './pet-shop-maelstrom';

describe('shop instance', () => {
  it('registers exactly the four pet-shop vessels', () => {
    expect(shop.vessels.map((entry) => entry.vessel.id).sort()).toEqual([
      'cart',
      'catalog',
      'checkout',
      'orders',
    ]);
  });
});
