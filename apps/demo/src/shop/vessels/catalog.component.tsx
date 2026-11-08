import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';

import { VesselCard } from '../../components/vessel-card';
import { VESSEL_ACCENTS } from '../../lib/design-tokens';
import { shopM } from '../maelstrom';
import { ProductImage } from '../product-image';
import { cartActions, cartResultToAction } from '../stores/cart.store';
import {
  type CatalogView,
  catalogActions,
  findProduct,
  useCatalogStore,
} from '../stores/catalog.store';
import {
  CATALOG_SKUS,
  FOOD_TYPES,
  type FoodType,
  formatCents,
  type Product,
  productBySku,
  SPECIES,
  type Species,
} from '../stores/fixtures';
import type { catalogVessel } from './catalog.vessel';

export default function CatalogComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof catalogVessel>) {
  const { view, results, selectedSku } = useCatalogStore();

  shopM.useActions('catalog', instanceId, {
    searchProducts: async (params) => {
      const species = params?.species?.toLowerCase();
      if (species !== undefined && !isSpecies(species)) {
        return err(
          new Error(
            `species must be ${quotedChoices(SPECIES)}, got "${species}"`,
          ),
        );
      }
      const foodType = params?.foodType?.toLowerCase();
      if (foodType !== undefined && !isFoodType(foodType)) {
        return err(
          new Error(
            `foodType must be ${quotedChoices(FOOD_TYPES)}, got "${foodType}"`,
          ),
        );
      }
      catalogActions.searchProducts({
        query: params?.query,
        species,
        foodType,
        maxFatPercent: params?.maxFatPercent,
      });
      return ok(undefined);
    },
    findSimilarProducts: async ({ sku, lowerFatOnly, maxFatPercent }) => {
      if (
        !catalogActions.findSimilarProducts(sku, {
          lowerFatOnly,
          maxFatPercent,
        })
      ) {
        return err(noMatchError(sku));
      }
      return ok(undefined);
    },
    showProductDetails: async ({ sku }) => {
      if (!catalogActions.showProductDetails(sku))
        return err(noMatchError(sku));
      return ok(undefined);
    },
    backToResults: async () => {
      catalogActions.backToResults();
      return ok(undefined);
    },
    clearSearch: async () => {
      catalogActions.clearSearch();
      return ok(undefined);
    },
    addToCart: async ({ sku }) =>
      cartResultToAction(cartActions.addToCart(sku), { sku }),
  });

  if (variantProps.variant === 'product') {
    const product = selectedSku ? findProduct(selectedSku) : undefined;
    return (
      <VesselCard
        accent={VESSEL_ACCENTS.catalog}
        label="Shop"
        meta={product ? product.sku : 'Product'}
      >
        <button
          type="button"
          onClick={() => executeAction('backToResults')}
          className="self-start text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)] mb-2"
        >
          ← Back to products
        </button>
        {product ? (
          <>
            <ProductDetail product={product} />
            <button
              type="button"
              onClick={() => executeAction('addToCart', { sku: product.sku })}
              className="mt-3 w-full shrink-0 rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm font-bold text-white hover:bg-[var(--color-brand-2)]"
            >
              Add to basket
            </button>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-ink-3)]">
            No product selected.
          </div>
        )}
      </VesselCard>
    );
  }

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.catalog}
      label="Shop"
      meta={`${results.length} product${results.length === 1 ? '' : 's'}`}
    >
      <div className="text-xs text-[var(--color-ink-3)] mb-2 truncate">
        {describeView(view)}
      </div>
      {results.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-ink-3)]">
          No products match.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {results.map((product) => (
            <li
              key={product.sku}
              className="shop-row-hover flex items-center gap-3 rounded-md py-1.5"
            >
              <ProductImage
                product={product}
                size="thumb"
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() =>
                    executeAction('showProductDetails', {
                      sku: product.sku,
                    })
                  }
                  className="w-full text-left text-[14px] leading-snug text-[var(--color-ink)] line-clamp-2"
                >
                  {product.name}
                </button>
                <div className="text-xs text-[var(--color-ink-3)]">
                  Fat {product.fatPercent}% · Protein {product.proteinPercent}%
                </div>
              </div>
              <div className="text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">
                {formatCents(product.priceCents)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </VesselCard>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const facts: [string, string, boolean?][] = [
    ['SKU', product.sku, true],
    ['Brand', product.brand],
    ['For', `${product.species}, ${product.lifeStage}`],
    ['Type', product.foodType],
    ['Size', product.size],
    ['Price', formatCents(product.priceCents)],
    ['Fat', `${product.fatPercent}%`],
    ['Protein', `${product.proteinPercent}%`],
  ];
  return (
    <div className="flex-1 min-h-0 flex gap-3 overflow-y-auto">
      <ProductImage product={product} size="hero" className="shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <div className="text-[15px] font-bold text-[var(--color-ink)]">
          {product.name}
        </div>
        <div className="text-[16px] font-bold tabular-nums text-[var(--color-ink)]">
          {formatCents(product.priceCents)}
        </div>
        <p className="shrink-0 text-[13px] leading-snug text-[var(--color-ink-2)] line-clamp-3">
          {product.description}
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          {facts.map(([label, value, mono]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--color-ink-3)] truncate">{label}</dt>
              <dd
                className={
                  mono
                    ? 'truncate whitespace-nowrap font-mono text-[11px] text-[var(--color-ink-3)]'
                    : 'truncate text-[var(--color-ink-2)]'
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function describeView(view: CatalogView): string {
  if (view.kind === 'all') return 'Everything in stock';
  if (view.kind === 'similar') {
    const reference = productBySku(view.referenceSku);
    const parts = [
      `Similar to ${reference?.name ?? view.referenceSku} (${reference?.fatPercent ?? '?'}% fat)`,
    ];
    if (view.options.lowerFatOnly) parts.push('lower fat only');
    if (view.options.maxFatPercent !== undefined) {
      parts.push(`fat ≤ ${view.options.maxFatPercent}%`);
    }
    return parts.join(' · ');
  }
  const { query, species, foodType, maxFatPercent } = view.criteria;
  const parts = [
    query ? `"${query}"` : null,
    species,
    foodType,
    maxFatPercent !== undefined ? `fat ≤ ${maxFatPercent}%` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0
    ? `Showing results for "${parts.join(' · ')}"`
    : 'Everything in stock';
}

function isSpecies(value: string): value is Species {
  return (SPECIES as readonly string[]).includes(value);
}

function isFoodType(value: string): value is FoodType {
  return (FOOD_TYPES as readonly string[]).includes(value);
}

function quotedChoices(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(' or ');
}

function noMatchError(sku: string): Error {
  return new Error(
    `No catalog product matches "${sku}". Available SKUs: ${CATALOG_SKUS.join(', ')}`,
  );
}
