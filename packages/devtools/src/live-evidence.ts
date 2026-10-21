import type { Devtools } from './types.js';

const epochs = new WeakMap<Devtools, number>();

export function liveEvidenceEpoch(tools: Devtools): number {
  return epochs.get(tools) ?? 0;
}

export function replaceLiveEvidence(tools: Devtools): void {
  epochs.set(tools, liveEvidenceEpoch(tools) + 1);
}
