import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_PRODUCTS, productBySku } from '../lib/pet-shop-fixtures';
import {
  __resetCatalogStoreForTests,
  catalogActions,
  findProduct,
  findSimilarProducts,
  getCatalogSnapshot,
  searchProducts,
} from './catalog.store';

const USUAL_DOG_FOOD = 'DOG-DRY-SUMMIT-ADULT-30';

beforeEach(() => {
  __resetCatalogStoreForTests();
});

describe('searchProducts', () => {
  it('returns the whole catalog for empty criteria', () => {
    expect(searchProducts({})).toHaveLength(CATALOG_PRODUCTS.length);
  });

  it('combines species, food type and max fat filters', () => {
    const results = searchProducts({
      species: 'dog',
      foodType: 'dry',
      maxFatPercent: 12,
    });
    expect(results.map((p) => p.sku).sort()).toEqual([
      'DOG-DRY-HARVEST-SENIOR-26',
      'DOG-DRY-NORTHPAW-LEAN-28',
      'DOG-DRY-SUMMIT-HW-30',
    ]);
  });

  it('matches free text against brand, name and description', () => {
    expect(searchProducts({ query: 'salmon', species: 'dog' })).toEqual([
      productBySku('DOG-DRY-HARVEST-SENS-30'),
    ]);
    expect(
      searchProducts({ query: 'Northpaw', species: 'cat' }).map((p) => p.sku),
    ).toEqual(['CAT-DRY-NORTHPAW-LIGHT-15', 'CAT-WET-NORTHPAW-SHRED-12']);
  });

  it('maps kibble to dry and ignores filler words', () => {
    const results = searchProducts({ query: 'kibble food for my cat' });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((p) => p.species === 'cat' && p.foodType === 'dry'),
    ).toBe(true);
  });

  it('falls back to any-token matches ranked by hits when no product matches every token', () => {
    const results = searchProducts({ query: 'turkey unicorn', species: 'dog' });
    expect(results.map((p) => p.sku)).toEqual([
      'DOG-DRY-NORTHPAW-LEAN-28',
      'DOG-WET-NORTHPAW-LEAN-12',
    ]);
  });
});

describe('findSimilarProducts', () => {
  it('offers lower-fat adult dry dog alternatives to the usual dog food, leanest first', () => {
    const usual = productBySku(USUAL_DOG_FOOD);
    if (!usual) throw new Error('fixture missing');
    expect(usual.fatPercent).toBeGreaterThanOrEqual(16);
    expect(usual.fatPercent).toBeLessThanOrEqual(18);

    const results = findSimilarProducts(usual, { lowerFatOnly: true });
    expect(results.map((p) => [p.sku, p.fatPercent])).toEqual([
      ['DOG-DRY-NORTHPAW-LEAN-28', 10],
      ['DOG-DRY-SUMMIT-HW-30', 11],
      ['DOG-DRY-HARVEST-SENS-30', 13],
    ]);
  });

  it('keeps higher-fat matches unless lowerFatOnly is set, and never the reference itself', () => {
    const usual = productBySku(USUAL_DOG_FOOD);
    if (!usual) throw new Error('fixture missing');
    const skus = findSimilarProducts(usual).map((p) => p.sku);
    expect(skus).toContain('DOG-DRY-NORTHPAW-PERF-30');
    expect(skus).not.toContain(USUAL_DOG_FOOD);
    expect(skus).not.toContain('DOG-DRY-SUMMIT-PUPPY-24');
    expect(skus).not.toContain('DOG-WET-NORTHPAW-LEAN-12');
  });

  it('applies maxFatPercent on top of similarity', () => {
    const usual = productBySku(USUAL_DOG_FOOD);
    if (!usual) throw new Error('fixture missing');
    expect(
      findSimilarProducts(usual, { maxFatPercent: 10 }).map((p) => p.sku),
    ).toEqual(['DOG-DRY-NORTHPAW-LEAN-28']);
  });
});

describe('findProduct', () => {
  it('resolves an exact SKU case-insensitively, then a product name', () => {
    expect(findProduct('dog-dry-summit-hw-30')?.sku).toBe(
      'DOG-DRY-SUMMIT-HW-30',
    );
    expect(findProduct('Healthy Weight')?.sku).toBe('DOG-DRY-SUMMIT-HW-30');
    expect(findProduct('nothing like this')).toBeUndefined();
  });
});

describe('catalogActions', () => {
  it('records the similarity view and its results in the store', () => {
    const outcome = catalogActions.findSimilarProducts(USUAL_DOG_FOOD, {
      lowerFatOnly: true,
    });
    expect(outcome?.results).toHaveLength(3);
    const snapshot = getCatalogSnapshot();
    expect(snapshot.view).toEqual({
      kind: 'similar',
      referenceSku: USUAL_DOG_FOOD,
      options: { lowerFatOnly: true },
    });
    expect(snapshot.results).toBe(outcome?.results);
  });

  it('returns null for an unknown reference SKU without touching state', () => {
    const before = getCatalogSnapshot();
    expect(catalogActions.findSimilarProducts('NOPE-1', {})).toBeNull();
    expect(getCatalogSnapshot()).toBe(before);
  });

  it('selects a product and clears the selection on backToResults', () => {
    catalogActions.searchProducts({ species: 'cat' });
    catalogActions.showProductDetails('CAT-DRY-NORTHPAW-LIGHT-15');
    expect(getCatalogSnapshot().selectedSku).toBe('CAT-DRY-NORTHPAW-LIGHT-15');
    catalogActions.backToResults();
    expect(getCatalogSnapshot().selectedSku).toBeNull();
    expect(getCatalogSnapshot().view.kind).toBe('search');
  });

  it('returns to the full catalog on clearSearch', () => {
    catalogActions.searchProducts({ species: 'cat', maxFatPercent: 5 });
    catalogActions.showProductDetails('CAT-WET-WHISKER-PATE-24');
    catalogActions.clearSearch();
    expect(getCatalogSnapshot()).toEqual({
      view: { kind: 'all' },
      results: CATALOG_PRODUCTS,
      selectedSku: null,
    });
  });
});
