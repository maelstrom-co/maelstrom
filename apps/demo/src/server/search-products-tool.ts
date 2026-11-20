import { serverTool } from '@maelstrom-co/engine';
import { z } from 'zod';

import {
  CATALOG_PRODUCTS,
  FOOD_TYPES,
  type LifeStage,
  type Product,
  SPECIES,
} from '../shop/stores/fixtures';

const SUMMARY_MAX_LENGTH = 200;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const LIFE_STAGES = [
  'puppy',
  'kitten',
  'adult',
  'senior',
  'all',
] as const satisfies readonly LifeStage[];

const searchProductsInputSchema = z.object({
  query: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Words that must all appear in the product name or brand, case-insensitive, e.g. "chicken" or "Summit Trail".',
    ),
  species: z.enum(SPECIES).optional(),
  foodType: z.enum(FOOD_TYPES).optional(),
  lifeStage: z.enum(LIFE_STAGES).optional(),
  excludeSkus: z
    .array(z.string())
    .max(20)
    .optional()
    .describe('SKUs to leave out, e.g. the items already in the order.'),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

const searchProductsOutputSchema = z.object({
  filters: z.object({
    query: z.string().optional(),
    species: z.enum(SPECIES).optional(),
    foodType: z.enum(FOOD_TYPES).optional(),
    lifeStage: z.enum(LIFE_STAGES).optional(),
  }),
  totalMatches: z.number().int().nonnegative(),
  products: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string(),
        brand: z.string(),
        species: z.enum(SPECIES),
        foodType: z.enum(FOOD_TYPES),
        lifeStage: z.enum(LIFE_STAGES),
        size: z.string(),
        priceCents: z.number().int().nonnegative(),
      }),
    )
    .max(MAX_LIMIT),
});

type SearchProductsInput = z.output<typeof searchProductsInputSchema>;
type SearchProductsOutput = z.output<typeof searchProductsOutputSchema>;

export const searchProductsTool = serverTool({
  name: 'search_products',
  description:
    'Searches the pet shop seed product catalog and returns matching products with their SKU, brand, species, food type, life stage, size and price. All filters are optional and combine. To find products similar to an order, search with a line item\'s main ingredient or brand as the query (e.g. "chicken"), its species, food type or life stage, and pass the ordered SKUs as excludeSkus.',
  input: searchProductsInputSchema,
  output: searchProductsOutputSchema,
  sideEffect: 'read_only',
  execute: async (input) => searchCatalog(CATALOG_PRODUCTS, input),
  summarize: summarizeSearch,
});

export function searchCatalog(
  products: readonly Product[],
  input: SearchProductsInput,
): SearchProductsOutput {
  const query = input.query?.trim() || undefined;
  const queryWords = query?.toLowerCase().split(/\s+/) ?? [];
  const excluded = new Set(
    (input.excludeSkus ?? []).map((sku) => sku.trim().toUpperCase()),
  );
  const matches = products.filter((product) => {
    if (excluded.has(product.sku)) return false;
    if (input.species && product.species !== input.species) return false;
    if (input.foodType && product.foodType !== input.foodType) return false;
    if (input.lifeStage && product.lifeStage !== input.lifeStage) return false;
    const haystack = `${product.name} ${product.brand}`.toLowerCase();
    return queryWords.every((word) => haystack.includes(word));
  });
  return {
    filters: {
      ...(query === undefined ? {} : { query }),
      ...(input.species === undefined ? {} : { species: input.species }),
      ...(input.foodType === undefined ? {} : { foodType: input.foodType }),
      ...(input.lifeStage === undefined ? {} : { lifeStage: input.lifeStage }),
    },
    totalMatches: matches.length,
    products: matches.slice(0, input.limit).map((product) => ({
      sku: product.sku,
      name: product.name,
      brand: product.brand,
      species: product.species,
      foodType: product.foodType,
      lifeStage: product.lifeStage,
      size: product.size,
      priceCents: product.priceCents,
    })),
  };
}

function summarizeSearch(result: SearchProductsOutput): string {
  const label = describeFilters(result.filters);
  const shown = result.products.length;
  if (shown === 0) {
    return truncateToSummaryLength(
      label === undefined
        ? 'No products found in the catalog'
        : `No products match ${label}`,
    );
  }
  const scope = label === undefined ? 'in the catalog' : `matching ${label}`;
  const noun = result.totalMatches === 1 ? 'product' : 'products';
  const showing = shown < result.totalMatches ? `, showing ${shown}` : '';
  return truncateToSummaryLength(
    `Found ${result.totalMatches} ${noun} ${scope}${showing}: ${result.products
      .map((product) => product.name)
      .join(', ')}`,
  );
}

function describeFilters(
  filters: SearchProductsOutput['filters'],
): string | undefined {
  const attributes = [filters.species, filters.foodType, filters.lifeStage]
    .filter((value) => value !== undefined)
    .join(', ');
  if (filters.query !== undefined) {
    const quoted = `"${filters.query}"`;
    return attributes ? `${quoted} (${attributes})` : quoted;
  }
  return attributes || undefined;
}

function truncateToSummaryLength(summary: string): string {
  const oneLine = summary.replace(/\s+/g, ' ').trim();
  return oneLine.length <= SUMMARY_MAX_LENGTH
    ? oneLine
    : `${oneLine.slice(0, SUMMARY_MAX_LENGTH - 3)}...`;
}
