import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../components/vessel-card';
import { VESSEL_ACCENTS } from '../lib/design-tokens';
import {
  CATALOG_SKUS,
  FOOD_TYPES,
  type FoodType,
  formatCents,
  type Product,
  productBySku,
  SPECIES,
  type Species,
} from '../lib/pet-shop-fixtures';
import { shop } from '../lib/pet-shop-maelstrom';
import {
  type CatalogView,
  catalogActions,
  findProduct,
  useCatalogStore,
} from './catalog.store';
import type { catalogVessel } from './catalog.vessel';

export default function CatalogComponent({
  instanceId,
  variantProps,
  executeAction,
}: TypedVesselProps<typeof catalogVessel>) {
  const { view, results, selectedSku } = useCatalogStore();

  shop.useActions('catalog', instanceId, {
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
  });

  if (variantProps.variant === 'product') {
    const product = selectedSku ? findProduct(selectedSku) : undefined;
    return (
      <VesselCard
        accent={VESSEL_ACCENTS.catalog}
        label="Catalog"
        meta={product ? product.sku : 'Product'}
      >
        <button
          type="button"
          onClick={() => executeAction('backToResults')}
          className="self-start text-xs font-mono text-ink-3 hover:text-ink mb-2"
        >
          ← Results
        </button>
        {product ? (
          <ProductDetail product={product} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-ink-3">
            No product selected.
          </div>
        )}
      </VesselCard>
    );
  }

  return (
    <VesselCard
      accent={VESSEL_ACCENTS.catalog}
      label="Catalog"
      meta={`${results.length} result${results.length === 1 ? '' : 's'}`}
    >
      <div className="text-xs text-ink-3 mb-2 truncate">
        {describeView(view)}
      </div>
      {results.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink-3">
          No products match.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-3 text-left">
                <th className="font-normal pb-1">Product</th>
                <th className="font-normal pb-1 text-right">Fat</th>
                <th className="font-normal pb-1 text-right">Protein</th>
                <th className="font-normal pb-1 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {results.map((product) => (
                <tr key={product.sku} className="align-top hover:bg-white/5">
                  <td className="py-1 pr-2">
                    <button
                      type="button"
                      onClick={() =>
                        executeAction('showProductDetails', {
                          sku: product.sku,
                        })
                      }
                      className="w-full text-left text-ink"
                    >
                      {product.name}
                    </button>
                    <div className="text-xs text-ink-3">
                      {product.species} · {product.foodType} ·{' '}
                      {product.lifeStage} · {product.size}
                    </div>
                  </td>
                  <td className="py-1 text-right font-mono text-ink-2">
                    {product.fatPercent}%
                  </td>
                  <td className="py-1 text-right font-mono text-ink-2">
                    {product.proteinPercent}%
                  </td>
                  <td className="py-1 text-right font-mono text-ink-2">
                    {formatCents(product.priceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </VesselCard>
  );
}

function ProductDetail({ product }: { product: Product }) {
  const facts: [string, string][] = [
    ['SKU', product.sku],
    ['Brand', product.brand],
    ['For', `${product.species}, ${product.lifeStage}`],
    ['Type', product.foodType],
    ['Size', product.size],
    ['Price', formatCents(product.priceCents)],
    ['Crude fat', `${product.fatPercent}%`],
    ['Crude protein', `${product.proteinPercent}%`],
  ];
  return (
    <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
      <div className="text-base text-ink">{product.name}</div>
      <p className="text-sm text-ink-2">{product.description}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-3">{label}</dt>
            <dd className="font-mono text-ink-2">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function describeView(view: CatalogView): string {
  if (view.kind === 'all') return 'Full catalog';
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
  return parts.length > 0 ? `Search: ${parts.join(' · ')}` : 'Full catalog';
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
