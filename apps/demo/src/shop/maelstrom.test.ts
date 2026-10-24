import { describe, expect, it } from 'vitest';
import { shopM } from './maelstrom';

describe('shop instance', () => {
  it('registers exactly the four pet-shop vessels', () => {
    expect(shopM.vessels.map((entry) => entry.vessel.id).sort()).toEqual([
      'cart',
      'catalog',
      'checkout',
      'orders',
    ]);
  });
});
