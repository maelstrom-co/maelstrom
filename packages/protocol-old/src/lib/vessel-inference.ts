import type { Vessel } from './vessel.js';

/** Extract literal variant names from a Vessel definition */
export type VariantNames<V extends Vessel> = keyof V['variants'] & string;

/** Discriminated union of variant props — each member has a synthetic `variant` discriminant */
export type VariantPropsUnion<V extends Vessel> = {
  [K in VariantNames<V>]: { variant: K } & V['variants'][K]['props'];
}[VariantNames<V>];

/** Extract all action names across all variants */
export type ActionNames<V extends Vessel> =
  V['variants'][keyof V['variants']]['actions'][number]['name'];
