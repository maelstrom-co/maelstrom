import type { DiagnosticEvent } from '@maelstrom-co/protocol';
import type { Devtools } from './types.js';

const epochs = new WeakMap<Devtools, number>();
const disposed = new WeakSet<Devtools>();
const owners = new WeakMap<Devtools, WeakMap<object, string>>();

export function liveEvidenceEpoch(tools: Devtools): number {
  return epochs.get(tools) ?? 0;
}

export function replaceLiveEvidence(tools: Devtools): void {
  epochs.set(tools, liveEvidenceEpoch(tools) + 1);
}

export function retireLiveEvidence(tools: Devtools): void {
  disposed.add(tools);
  replaceLiveEvidence(tools);
}

export function liveEvidenceDisposed(tools: Devtools): boolean {
  return disposed.has(tools);
}

export function retainLiveEventOwner(
  tools: Devtools,
  event: DiagnosticEvent,
  clientId: string,
): void {
  let retained = owners.get(tools);
  if (!retained) {
    retained = new WeakMap();
    owners.set(tools, retained);
  }
  retained.set(event, clientId);
}

export function liveEventOwner(
  tools: Devtools,
  event: object,
): string | undefined {
  return owners.get(tools)?.get(event);
}
