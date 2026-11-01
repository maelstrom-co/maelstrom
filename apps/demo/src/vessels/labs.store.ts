import { err, ok } from '@maelstrom-co/protocol';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { LAB_MARKER_SLUGS, type LabMarkerSlug } from './labs.vessel.def';

const selection = z.strictObject({ markerSlug: z.enum(LAB_MARKER_SLUGS) });
// Instance identity survives Variant remounts; this selection is not reload-durable.
const selected = new Map<string, LabMarkerSlug>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLabsSelection(instanceId: string): LabMarkerSlug | null {
  return selected.get(instanceId) ?? null;
}

export function useLabsSelection(instanceId: string): LabMarkerSlug | null {
  return useSyncExternalStore(
    subscribe,
    () => getLabsSelection(instanceId),
    () => null,
  );
}

export function createLabsActionRunner(instanceId: string) {
  return {
    // The Chart owns navigation; handlers must not maintain a second view state.
    showList: () => ok(undefined),
    showTrends: () => ok(undefined),
    selectMarker: (params: unknown) => {
      const parsed = selection.safeParse(params);
      if (!parsed.success)
        return err(new Error('Invalid Labs marker selection.'));
      if (getLabsSelection(instanceId) !== parsed.data.markerSlug) {
        selected.set(instanceId, parsed.data.markerSlug);
        for (const listener of listeners) listener();
      }
      return ok(undefined);
    },
  };
}
