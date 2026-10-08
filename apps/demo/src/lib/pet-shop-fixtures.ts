export type Species = 'dog' | 'cat';
export type FoodType = 'dry' | 'wet';
export type LifeStage = 'puppy' | 'kitten' | 'adult' | 'senior' | 'all';

export const SPECIES: readonly Species[] = ['dog', 'cat'];
export const FOOD_TYPES: readonly FoodType[] = ['dry', 'wet'];

export interface Product {
  sku: string;
  name: string;
  brand: string;
  species: Species;
  foodType: FoodType;
  lifeStage: LifeStage;
  size: string;
  priceCents: number;
  /** Guaranteed-analysis crude fat, as-fed. */
  fatPercent: number;
  /** Guaranteed-analysis crude protein, as-fed. */
  proteinPercent: number;
  description: string;
}

export interface OrderLineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderTotals {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
}

export interface Order {
  id: string;
  /** ISO date, `YYYY-MM-DD`. */
  placedOn: string;
  status: 'delivered' | 'processing';
  items: OrderLineItem[];
  totals: OrderTotals;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
}

export interface PaymentMethod {
  label: string;
}

export interface Customer {
  name: string;
  pets: readonly { name: string; species: Species; note: string }[];
  shippingAddress: ShippingAddress;
  paymentMethod: PaymentMethod;
}

export const FREE_SHIPPING_THRESHOLD_CENTS = 4900;
export const FLAT_SHIPPING_CENTS = 599;
export const TAX_RATE = 0.08;

export const CUSTOMER: Customer = {
  name: 'Sam Rivera',
  pets: [
    { name: 'Biscuit', species: 'dog', note: '6-year-old Labrador' },
    { name: 'Miso', species: 'cat', note: '4-year-old indoor tabby' },
  ],
  shippingAddress: {
    name: 'Sam Rivera',
    line1: '418 Alder Street, Apt 3',
    city: 'Portland',
    region: 'OR',
    postalCode: '97205',
  },
  paymentMethod: { label: 'Visa ending 4242' },
};

export const CATALOG_PRODUCTS: readonly Product[] = [
  {
    sku: 'DOG-DRY-SUMMIT-ADULT-30',
    name: 'Summit Trail Adult Chicken & Brown Rice',
    brand: 'Summit Trail',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'adult',
    size: '30 lb bag',
    priceCents: 6499,
    fatPercent: 17,
    proteinPercent: 26,
    description:
      'Everyday adult kibble with real chicken as the first ingredient and whole brown rice.',
  },
  {
    sku: 'DOG-DRY-SUMMIT-HW-30',
    name: 'Summit Trail Healthy Weight Chicken & Barley',
    brand: 'Summit Trail',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'adult',
    size: '30 lb bag',
    priceCents: 6699,
    fatPercent: 11,
    proteinPercent: 25,
    description:
      'Reduced-fat adult kibble with added fiber and L-carnitine for weight management.',
  },
  {
    sku: 'DOG-DRY-NORTHPAW-LEAN-28',
    name: 'Northpaw Lean Turkey & Oatmeal',
    brand: 'Northpaw',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'adult',
    size: '28 lb bag',
    priceCents: 7149,
    fatPercent: 10,
    proteinPercent: 27,
    description:
      'Lean, high-protein adult kibble built on turkey for less active or overweight dogs.',
  },
  {
    sku: 'DOG-DRY-HARVEST-SENS-30',
    name: 'Harvest Hound Sensitive Stomach Salmon & Rice',
    brand: 'Harvest Hound',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'all',
    size: '30 lb bag',
    priceCents: 6899,
    fatPercent: 13,
    proteinPercent: 24,
    description:
      'Gentle salmon-and-rice kibble for all life stages, moderate fat and easy to digest.',
  },
  {
    sku: 'DOG-DRY-NORTHPAW-PERF-30',
    name: 'Northpaw Performance Beef & Sweet Potato',
    brand: 'Northpaw',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'adult',
    size: '30 lb bag',
    priceCents: 7499,
    fatPercent: 20,
    proteinPercent: 30,
    description:
      'Calorie-dense, high-fat kibble for working and highly active adult dogs.',
  },
  {
    sku: 'DOG-DRY-SUMMIT-PUPPY-24',
    name: 'Summit Trail Puppy Chicken & Oatmeal',
    brand: 'Summit Trail',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'puppy',
    size: '24 lb bag',
    priceCents: 5899,
    fatPercent: 18,
    proteinPercent: 28,
    description: 'Small-bite puppy kibble with DHA for brain and eye growth.',
  },
  {
    sku: 'DOG-DRY-HARVEST-SENIOR-26',
    name: 'Harvest Hound Senior Vitality Chicken',
    brand: 'Harvest Hound',
    species: 'dog',
    foodType: 'dry',
    lifeStage: 'senior',
    size: '26 lb bag',
    priceCents: 6299,
    fatPercent: 10,
    proteinPercent: 25,
    description:
      'Lower-calorie senior kibble with glucosamine for aging joints.',
  },
  {
    sku: 'DOG-WET-SUMMIT-STEW-12',
    name: 'Summit Trail Chicken & Vegetable Stew',
    brand: 'Summit Trail',
    species: 'dog',
    foodType: 'wet',
    lifeStage: 'adult',
    size: '12 x 13 oz cans',
    priceCents: 3499,
    fatPercent: 5,
    proteinPercent: 8,
    description: 'Hearty chunks in gravy, works as a meal or a kibble topper.',
  },
  {
    sku: 'DOG-WET-NORTHPAW-LEAN-12',
    name: 'Northpaw Lean Turkey Loaf',
    brand: 'Northpaw',
    species: 'dog',
    foodType: 'wet',
    lifeStage: 'adult',
    size: '12 x 13 oz cans',
    priceCents: 3699,
    fatPercent: 3,
    proteinPercent: 9,
    description: 'Low-fat turkey loaf for dogs on a weight-control plan.',
  },
  {
    sku: 'CAT-DRY-WHISKER-INDOOR-16',
    name: 'Whisker & Co Indoor Adult Chicken',
    brand: 'Whisker & Co',
    species: 'cat',
    foodType: 'dry',
    lifeStage: 'adult',
    size: '16 lb bag',
    priceCents: 4299,
    fatPercent: 14,
    proteinPercent: 34,
    description:
      'Indoor-cat kibble with hairball control fiber and moderate calories.',
  },
  {
    sku: 'CAT-DRY-WHISKER-KITTEN-7',
    name: 'Whisker & Co Kitten Salmon',
    brand: 'Whisker & Co',
    species: 'cat',
    foodType: 'dry',
    lifeStage: 'kitten',
    size: '7 lb bag',
    priceCents: 2499,
    fatPercent: 20,
    proteinPercent: 38,
    description: 'Rich, high-protein kitten kibble with DHA.',
  },
  {
    sku: 'CAT-DRY-NORTHPAW-LIGHT-15',
    name: 'Northpaw Light Turkey',
    brand: 'Northpaw',
    species: 'cat',
    foodType: 'dry',
    lifeStage: 'adult',
    size: '15 lb bag',
    priceCents: 4549,
    fatPercent: 9,
    proteinPercent: 36,
    description:
      'Low-fat, high-protein kibble for cats that need to slim down.',
  },
  {
    sku: 'CAT-WET-WHISKER-PATE-24',
    name: 'Whisker & Co Ocean Fish Pate',
    brand: 'Whisker & Co',
    species: 'cat',
    foodType: 'wet',
    lifeStage: 'adult',
    size: '24 x 3 oz cans',
    priceCents: 2799,
    fatPercent: 5,
    proteinPercent: 11,
    description: 'Smooth ocean-fish pate, a hydration boost for adult cats.',
  },
  {
    sku: 'CAT-WET-HARVEST-SENIOR-24',
    name: 'Harvest Table Senior Chicken Pate',
    brand: 'Harvest Table',
    species: 'cat',
    foodType: 'wet',
    lifeStage: 'senior',
    size: '24 x 3 oz cans',
    priceCents: 2999,
    fatPercent: 4,
    proteinPercent: 10,
    description: 'Soft senior pate with added taurine and kidney support.',
  },
  {
    sku: 'CAT-WET-NORTHPAW-SHRED-12',
    name: 'Northpaw Shredded Chicken in Gravy',
    brand: 'Northpaw',
    species: 'cat',
    foodType: 'wet',
    lifeStage: 'all',
    size: '12 x 5.5 oz cans',
    priceCents: 2199,
    fatPercent: 3,
    proteinPercent: 12,
    description: 'Shredded chicken in a light gravy for cats of every age.',
  },
];

export const CATALOG_SKUS: readonly string[] = CATALOG_PRODUCTS.map(
  (product) => product.sku,
);

/** Newest first. Every line item references a catalog SKU. */
export const SEED_ORDERS: readonly Order[] = [
  seedOrder('ORD-10455', '2026-09-14', [
    ['DOG-DRY-SUMMIT-ADULT-30', 1],
    ['CAT-DRY-WHISKER-INDOOR-16', 1],
  ]),
  seedOrder('ORD-10421', '2026-08-12', [['DOG-DRY-SUMMIT-ADULT-30', 1]]),
  seedOrder('ORD-10388', '2026-07-10', [
    ['DOG-DRY-SUMMIT-ADULT-30', 1],
    ['CAT-WET-WHISKER-PATE-24', 2],
  ]),
  seedOrder('ORD-10307', '2026-06-08', [
    ['DOG-DRY-SUMMIT-ADULT-30', 1],
    ['DOG-WET-SUMMIT-STEW-12', 1],
  ]),
];

/** Looks a product up by exact SKU, case-insensitively. */
export function productBySku(sku: string): Product | undefined {
  const wanted = sku.trim().toUpperCase();
  return CATALOG_PRODUCTS.find((product) => product.sku === wanted);
}

/** Subtotal, flat-rate shipping (free at or above the threshold) and tax, all in cents. */
export function calculateOrderTotals(
  items: readonly Pick<OrderLineItem, 'quantity' | 'unitPriceCents'>[],
): OrderTotals {
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceCents,
    0,
  );
  const shippingCents =
    subtotalCents === 0 || subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
      ? 0
      : FLAT_SHIPPING_CENTS;
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatAddress(address: ShippingAddress): string {
  return `${address.line1}, ${address.city}, ${address.region} ${address.postalCode}`;
}

function seedOrder(
  id: string,
  placedOn: string,
  lines: readonly (readonly [sku: string, quantity: number])[],
): Order {
  const items = lines.map(([sku, quantity]) => {
    const product = productBySku(sku);
    if (!product) throw new Error(`Seed order ${id} names unknown SKU ${sku}`);
    return {
      sku,
      name: product.name,
      quantity,
      unitPriceCents: product.priceCents,
    };
  });
  return {
    id,
    placedOn,
    status: 'delivered',
    items,
    totals: calculateOrderTotals(items),
  };
}
