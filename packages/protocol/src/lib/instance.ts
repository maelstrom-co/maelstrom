import type { Brand } from './brand.js';

/**
 * Opaque identifier for a vessel instance in a chart.
 * Unique within a chart session; used to correlate layout positions,
 * tiling tree leaves, and execution plan actions with a concrete instance.
 */
export type InstanceId = Brand<string, 'InstanceId'>;

/**
 * Brands a string as an InstanceId without changing its value.
 * Used at boundaries where untyped strings (LLM output, wire messages)
 * must be lifted into the typed domain.
 */
export const InstanceId = (value: string): InstanceId => {
  if (value === '') {
    throw new Error('InstanceId("") is not allowed. Pass a non-empty string.');
  }
  return value as InstanceId;
};
