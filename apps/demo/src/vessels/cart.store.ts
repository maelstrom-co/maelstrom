import { useSyncExternalStore } from 'react';
import {
  calculateOrderTotals,
  type OrderLineItem,
  type OrderTotals,
  type Product,
} from '../lib/pet-shop-fixtures';
import { findProduct } from './catalog.store';

export type CartLine = OrderLineItem;

interface CartState {
  lines: readonly CartLine[];
}

export type CartMutationResult =
  | { ok: true; line: CartLine | null }
  | { ok: false; reason: 'unknown_product' | 'not_in_cart' | 'bad_quantity' }
  | { ok: false; reason: 'ambiguous'; candidates: readonly string[] };

type LineMatch =
  | { kind: 'found'; line: CartLine }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: readonly string[] };

const INITIAL_STATE: CartState = { lines: [] };

let state: CartState = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useCartStore(): CartState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getCartSnapshot(): CartState {
  return state;
}

export function cartTotals(
  lines: readonly CartLine[] = state.lines,
): OrderTotals {
  return calculateOrderTotals(lines);
}

export function __resetCartStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const cartActions = {
  addToCart(skuOrName: string, quantity = 1): CartMutationResult {
    if (!isPositiveInteger(quantity))
      return { ok: false, reason: 'bad_quantity' };
    const product = findProduct(skuOrName);
    if (!product) return { ok: false, reason: 'unknown_product' };
    const existing = state.lines.find((line) => line.sku === product.sku);
    const line: CartLine = existing
      ? { ...existing, quantity: existing.quantity + quantity }
      : lineFor(product, quantity);
    setState({
      lines: existing
        ? state.lines.map((l) => (l.sku === product.sku ? line : l))
        : [...state.lines, line],
    });
    return { ok: true, line };
  },
  removeFromCart(skuOrName: string): CartMutationResult {
    const match = findLine(skuOrName);
    if (match.kind !== 'found') return lineLookupFailure(match);
    setState({ lines: state.lines.filter((l) => l.sku !== match.line.sku) });
    return { ok: true, line: null };
  },
  updateCartQuantity(skuOrName: string, quantity: number): CartMutationResult {
    if (quantity === 0) return cartActions.removeFromCart(skuOrName);
    if (!isPositiveInteger(quantity))
      return { ok: false, reason: 'bad_quantity' };
    const match = findLine(skuOrName);
    if (match.kind !== 'found') return lineLookupFailure(match);
    const line = { ...match.line, quantity };
    setState({
      lines: state.lines.map((l) => (l.sku === line.sku ? line : l)),
    });
    return { ok: true, line };
  },
  clearCart(): void {
    setState(INITIAL_STATE);
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CartState {
  return state;
}

function setState(next: CartState): void {
  state = next;
  for (const l of listeners) l();
}

function findLine(skuOrName: string): LineMatch {
  const query = skuOrName.trim();
  const bySku = state.lines.find((line) => line.sku === query.toUpperCase());
  if (bySku) return { kind: 'found', line: bySku };
  const name = query.toLowerCase();
  const byName = name
    ? state.lines.filter((line) => line.name.toLowerCase().includes(name))
    : [];
  if (byName.length > 1) {
    return { kind: 'ambiguous', candidates: byName.map((line) => line.sku) };
  }
  return byName[0] ? { kind: 'found', line: byName[0] } : { kind: 'none' };
}

function lineLookupFailure(
  match: Exclude<LineMatch, { kind: 'found' }>,
): CartMutationResult {
  return match.kind === 'ambiguous'
    ? { ok: false, reason: 'ambiguous', candidates: match.candidates }
    : { ok: false, reason: 'not_in_cart' };
}

function lineFor(product: Product, quantity: number): CartLine {
  return {
    sku: product.sku,
    name: product.name,
    quantity,
    unitPriceCents: product.priceCents,
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
