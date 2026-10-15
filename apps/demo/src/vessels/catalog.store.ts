import { useSyncExternalStore } from 'react';
import {
  CATALOG_PRODUCTS,
  type FoodType,
  type Product,
  productBySku,
  type Species,
} from '../lib/pet-shop-fixtures';
import { findByFuzzyTitle } from './find-by-fuzzy-title';

export interface SearchCriteria {
  query?: string;
  species?: Species;
  foodType?: FoodType;
  maxFatPercent?: number;
}

export interface SimilarOptions {
  lowerFatOnly?: boolean;
  maxFatPercent?: number;
}

export type CatalogView =
  | { kind: 'all' }
  | { kind: 'search'; criteria: SearchCriteria }
  | { kind: 'similar'; referenceSku: string; options: SimilarOptions };

interface CatalogState {
  view: CatalogView;
  results: readonly Product[];
  selectedSku: string | null;
}

const INITIAL_STATE: CatalogState = {
  view: { kind: 'all' },
  results: CATALOG_PRODUCTS,
  selectedSku: null,
};

let state: CatalogState = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useCatalogStore(): CatalogState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getCatalogSnapshot(): CatalogState {
  return state;
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function __resetCatalogStoreForTests(): void {
  setState(INITIAL_STATE);
}

/** Resolves an exact SKU first, then falls back to a fuzzy product-name match. */
export function findProduct(skuOrName: string): Product | undefined {
  return (
    productBySku(skuOrName) ??
    findByFuzzyTitle(
      CATALOG_PRODUCTS.map((product) => ({ ...product, title: product.name })),
      skuOrName,
    )
  );
}

/**
 * Structured filters narrow first; free text then has to match every
 * meaningful token. When no product matches every token the search relaxes
 * to any-token matches ranked by hit count, so a wordy model query still
 * returns something sensible inside the structured filters.
 */
export function searchProducts(
  criteria: SearchCriteria,
  catalog: readonly Product[] = CATALOG_PRODUCTS,
): Product[] {
  const filtered = catalog.filter(
    (product) =>
      (!criteria.species || product.species === criteria.species) &&
      (!criteria.foodType || product.foodType === criteria.foodType) &&
      (criteria.maxFatPercent === undefined ||
        product.fatPercent <= criteria.maxFatPercent),
  );
  const tokens = queryTokens(criteria.query ?? '');
  if (tokens.length === 0) return filtered;

  const scored = filtered.map((product) => {
    const haystack = searchableText(product);
    return {
      product,
      hits: tokens.filter((token) => haystack.includes(token)).length,
    };
  });
  const allTokens = scored.filter(({ hits }) => hits === tokens.length);
  if (allTokens.length > 0) return allTokens.map(({ product }) => product);
  return scored
    .filter(({ hits }) => hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map(({ product }) => product);
}

/**
 * Same species and food type as the reference, with a compatible life stage
 * (identical, or either side is an all-life-stages formula). Sorted by fat
 * ascending so the leanest alternative comes first.
 */
export function findSimilarProducts(
  reference: Product,
  options: SimilarOptions = {},
  catalog: readonly Product[] = CATALOG_PRODUCTS,
): Product[] {
  return catalog
    .filter(
      (product) =>
        product.sku !== reference.sku &&
        product.species === reference.species &&
        product.foodType === reference.foodType &&
        lifeStagesCompatible(product, reference) &&
        (!options.lowerFatOnly || product.fatPercent < reference.fatPercent) &&
        (options.maxFatPercent === undefined ||
          product.fatPercent <= options.maxFatPercent),
    )
    .sort((a, b) => a.fatPercent - b.fatPercent || a.priceCents - b.priceCents);
}

export const catalogActions = {
  searchProducts(criteria: SearchCriteria): readonly Product[] {
    const results = searchProducts(criteria);
    setState({
      view: { kind: 'search', criteria },
      results,
      selectedSku: null,
    });
    return results;
  },
  findSimilarProducts(
    skuOrName: string,
    options: SimilarOptions,
  ): { reference: Product; results: readonly Product[] } | null {
    const reference = findProduct(skuOrName);
    if (!reference) return null;
    const results = findSimilarProducts(reference, options);
    setState({
      view: { kind: 'similar', referenceSku: reference.sku, options },
      results,
      selectedSku: null,
    });
    return { reference, results };
  },
  showProductDetails(skuOrName: string): Product | null {
    const product = findProduct(skuOrName);
    if (!product) return null;
    setState({ ...state, selectedSku: product.sku });
    return product;
  },
  backToResults(): void {
    setState({ ...state, selectedSku: null });
  },
  clearSearch(): void {
    setState(INITIAL_STATE);
  },
};

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'food',
  'foods',
  'for',
  'formula',
  'my',
  'of',
  'or',
  'recipe',
  'the',
  'with',
]);

const SYNONYMS: Record<string, string> = {
  kibble: 'dry',
  canned: 'wet',
  can: 'wet',
  cans: 'wet',
  puppies: 'puppy',
  kittens: 'kitten',
  dogs: 'dog',
  cats: 'cat',
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CatalogState {
  return state;
}

function setState(next: CatalogState): void {
  state = next;
  for (const l of listeners) l();
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9&]+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map((token) => SYNONYMS[token] ?? token);
}

function searchableText(product: Product): string {
  return [
    product.sku,
    product.name,
    product.brand,
    product.species,
    product.foodType,
    product.lifeStage,
    product.description,
  ]
    .join(' ')
    .toLowerCase();
}

function lifeStagesCompatible(a: Product, b: Product): boolean {
  return (
    a.lifeStage === b.lifeStage ||
    a.lifeStage === 'all' ||
    b.lifeStage === 'all'
  );
}
