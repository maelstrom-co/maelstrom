import { defineVessel } from '@maelstrom-co/protocol';
import { CATALOG_SKUS, FOOD_TYPES, SPECIES } from '../lib/pet-shop-fixtures';
import { withActionOptions } from '../lib/vessel-options';

const SEARCH_PRODUCTS = {
  name: 'searchProducts',
  idempotent: true,
  description:
    'Search the pet-food catalog and show matching products with price, fat % and protein %. Every parameter is optional and they combine: use species, foodType and maxFatPercent for structured criteria, and query for free text such as a brand, protein source or need ("salmon", "Northpaw", "sensitive stomach", "weight"). Call with no parameters to list the whole catalog.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      required: false,
      description:
        'Free text matched against product name, brand, description, species, food type and life stage. Filler words are ignored and kibble/canned map to dry/wet. Leave out words already covered by the other filters.',
    },
    {
      name: 'species',
      type: 'string',
      required: false,
      description: 'Only show food for this species: dog or cat.',
    },
    {
      name: 'foodType',
      type: 'string',
      required: false,
      description: 'Only show dry (kibble) or wet (canned) food.',
    },
    {
      name: 'maxFatPercent',
      type: 'number',
      required: false,
      description:
        'Only show products whose crude fat is at most this percentage, e.g. 14.',
    },
  ],
} as const;

const FIND_SIMILAR_PRODUCTS = {
  name: 'findSimilarProducts',
  idempotent: true,
  description:
    'Show products similar to a given product: same species, same food type (dry or wet) and a compatible life stage, sorted leanest first. Set lowerFatOnly to keep only alternatives with less fat than the reference product. This is the way to answer "something like what I usually buy but lower in fat".',
  parameters: [
    {
      name: 'sku',
      type: 'string',
      description:
        'SKU of the reference product, e.g. the SKU from a past order line item.',
    },
    {
      name: 'lowerFatOnly',
      type: 'boolean',
      required: false,
      description:
        'When true, only include products with a lower fat % than the reference product.',
    },
    {
      name: 'maxFatPercent',
      type: 'number',
      required: false,
      description: 'Optional upper bound on crude fat percentage, e.g. 12.',
    },
  ],
} as const;

const SHOW_PRODUCT_DETAILS = {
  name: 'showProductDetails',
  idempotent: true,
  description:
    'Open one product to see its full details: brand, size, price, fat %, protein %, life stage and description.',
  parameters: [
    {
      name: 'sku',
      type: 'string',
      description: 'SKU of the product to open.',
    },
  ],
} as const;

const CLEAR_SEARCH = {
  name: 'clearSearch',
  idempotent: true,
  description:
    'Clear any search or similarity filter and list the whole catalog.',
} as const;

const baseCatalogVessel = defineVessel({
  id: 'catalog',
  name: 'Pet Food Catalog',
  description:
    'Pet-food store catalog of dog and cat food, dry and wet, with brand, bag or case size, price, crude fat % and protein %, and life stage. Results view lists the products from the latest search or similarity lookup; product view shows one product in detail. Use it to search by species, food type, fat limit or free text, and to find alternatives similar to a product the customer already buys. Adding to the cart is done on the cart vessel with addToCart.',
  defaultVariant: 'results',
  variants: {
    results: {
      props: {},
      minSize: { width: 5, height: 4 },
      actions: [
        SEARCH_PRODUCTS,
        FIND_SIMILAR_PRODUCTS,
        { ...SHOW_PRODUCT_DETAILS, transitionsTo: 'product' },
        CLEAR_SEARCH,
      ],
    },
    product: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        { ...SEARCH_PRODUCTS, transitionsTo: 'results' },
        { ...FIND_SIMILAR_PRODUCTS, transitionsTo: 'results' },
        SHOW_PRODUCT_DETAILS,
        { ...CLEAR_SEARCH, transitionsTo: 'results' },
        {
          name: 'backToResults',
          idempotent: true,
          description: 'Return to the list of search results',
          transitionsTo: 'results',
        },
      ],
    },
  },
});

export const catalogVessel = withActionOptions(baseCatalogVessel, {
  searchProducts: { species: SPECIES, foodType: FOOD_TYPES },
  findSimilarProducts: { sku: CATALOG_SKUS },
  showProductDetails: { sku: CATALOG_SKUS },
});
