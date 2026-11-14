import type { ServerToolContext } from '@maelstrom-co/engine';
import { describe, expect, it } from 'vitest';

import { searchProductsTool } from './search-products-tool';

const LATEST_ORDER_SKUS = [
  'DOG-DRY-SUMMIT-ADULT-30',
  'CAT-DRY-WHISKER-INDOOR-16',
];

describe('searchProductsTool', () => {
  it('matches every query word case-insensitively against name and brand', async () => {
    const output = await search({ query: 'SUMMIT chicken' });

    expect(output.products.map((product) => product.sku)).toEqual([
      'DOG-DRY-SUMMIT-ADULT-30',
      'DOG-DRY-SUMMIT-HW-30',
      'DOG-DRY-SUMMIT-PUPPY-24',
      'DOG-WET-SUMMIT-STEW-12',
    ]);
    expect(searchProductsTool.output.safeParse(output).success).toBe(true);
  });

  it('declares the listed SKUs and the total match count as intent facts', async () => {
    const output = await search({ query: 'SUMMIT chicken', limit: 2 });

    expect(searchProductsTool.intentFacts?.(output)).toEqual({
      skus: ['DOG-DRY-SUMMIT-ADULT-30', 'DOG-DRY-SUMMIT-HW-30'],
      totalMatches: 4,
    });
  });

  it('matches the brand when the name does not contain the query', async () => {
    const output = await search({ query: 'harvest table' });

    expect(output.products.map((product) => product.sku)).toEqual([
      'CAT-WET-HARVEST-SENIOR-24',
    ]);
  });

  it('filters by species, food type and life stage and returns those attributes', async () => {
    const output = await search({
      species: 'cat',
      foodType: 'dry',
      lifeStage: 'adult',
    });

    expect(output.products.map((product) => product.sku)).toEqual([
      'CAT-DRY-WHISKER-INDOOR-16',
      'CAT-DRY-NORTHPAW-LIGHT-15',
    ]);
    for (const product of output.products) {
      expect(product).toMatchObject({
        species: 'cat',
        foodType: 'dry',
        lifeStage: 'adult',
      });
    }
  });

  it('defaults to five results and reports the total match count', async () => {
    const output = await search({});

    expect(output.products).toHaveLength(5);
    expect(output.totalMatches).toBe(15);
  });

  it('bounds the results by the given limit', async () => {
    const output = await search({ query: 'chicken', limit: 2 });

    expect(output.products).toHaveLength(2);
    expect(output.totalMatches).toBeGreaterThan(2);
  });

  it('leaves out excluded SKUs regardless of case and whitespace', async () => {
    const output = await search({
      query: 'chicken',
      excludeSkus: [' dog-dry-summit-adult-30 ', LATEST_ORDER_SKUS[1]],
      limit: 10,
    });

    const skus = output.products.map((product) => product.sku);
    expect(skus).not.toContain('DOG-DRY-SUMMIT-ADULT-30');
    expect(skus).not.toContain('CAT-DRY-WHISKER-INDOOR-16');
    expect(skus).toHaveLength(6);
  });

  it('summarizes the matches, the filters and the shown subset in one line', async () => {
    const output = await search({
      query: 'chicken',
      excludeSkus: LATEST_ORDER_SKUS,
    });

    const summary = searchProductsTool.summarize(output);

    expect(summary).toMatch(
      /^Found 6 products matching "chicken", showing 5: Summit Trail Healthy Weight Chicken & Barley, /,
    );
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).not.toMatch(/\n/);
  });

  it('names the attribute filters in the summary', async () => {
    const output = await search({ query: 'turkey', species: 'cat' });

    expect(searchProductsTool.summarize(output)).toBe(
      'Found 1 product matching "turkey" (cat): Northpaw Light Turkey',
    );
  });

  it('summarizes an empty result with the filters that matched nothing', async () => {
    const output = await search({
      query: 'salmon',
      species: 'cat',
      lifeStage: 'senior',
    });

    expect(output.products).toEqual([]);
    expect(output.totalMatches).toBe(0);
    expect(searchProductsTool.summarize(output)).toBe(
      'No products match "salmon" (cat, senior)',
    );
  });

  it('keeps a summary of a long query within 200 characters', async () => {
    const output = await search({ query: `${'a'.repeat(99)} `, limit: 10 });

    const summary = searchProductsTool.summarize(output);

    expect(summary.trim()).not.toBe('');
    expect(summary.length).toBeLessThanOrEqual(200);
  });

  it.each([0, 11, 2.5, '5'])('rejects a limit of %j', (limit) => {
    expect(searchProductsTool.input.safeParse({ limit }).success).toBe(false);
  });

  it('rejects an unknown species', () => {
    expect(
      searchProductsTool.input.safeParse({ species: 'bird' }).success,
    ).toBe(false);
  });

  it('is a read-only tool with a valid name that describes the seed catalog', () => {
    expect(searchProductsTool.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(searchProductsTool.sideEffect).toBe('read_only');
    expect(searchProductsTool.description).toMatch(/seed product catalog/);
    expect(searchProductsTool.description).toMatch(/similar to an order/);
    expect(searchProductsTool.description).toMatch(/excludeSkus/);
  });
});

async function search(rawInput: unknown) {
  const input = searchProductsTool.input.parse(rawInput);
  return searchProductsTool.execute(input, contextFor());
}

function contextFor(): ServerToolContext {
  return { user: undefined, signal: new AbortController().signal };
}
