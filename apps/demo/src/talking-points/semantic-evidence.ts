import type { TakeEvidence } from './live-take';

export const COVERAGE_ITEM_LIMIT = 4;
export const COVERAGE_CODE_POINT_LIMIT = 8000;

type Part = {
  contentIndex: number;
  transcript?: string;
  status: 'final' | 'failed' | 'uncertain';
};
type Item = {
  itemId: string;
  previousItemId?: string | null;
  committed: boolean;
  evicted: boolean;
  uncertain: boolean;
  parts: Map<number, Part>;
};
export interface CoverageEvidence {
  readonly takeId: string;
  readonly connectionId: string;
  readonly items: readonly {
    readonly itemId: string;
    readonly previousItemId: string | null;
    readonly status: 'committed' | 'uncertain';
    readonly parts: readonly Readonly<Part>[];
  }[];
}

// Text is bounded; exact identity/link tombstones grow with source items until Reset.
export function createSemanticEvidence(takeId: string, connectionId: string) {
  const items = new Map<string, Item>();
  let snapshot: CoverageEvidence = { takeId, connectionId, items: [] };
  function reconcile() {
    const successors = new Map<string | null, Item[]>();
    for (const item of items.values()) {
      if (!item.committed || item.previousItemId === undefined) continue;
      const siblings = successors.get(item.previousItemId) ?? [];
      siblings.push(item);
      successors.set(item.previousItemId, siblings);
    }
    const ordered: Item[] = [];
    const visited = new Set<string>();
    let following: Item[] | undefined = successors.get(null);
    while (following?.length === 1) {
      const item: Item | undefined = following[0];
      if (!item || visited.has(item.itemId)) break;
      visited.add(item.itemId);
      ordered.push(item);
      following = successors.get(item.itemId);
    }
    const retained = ordered.slice(-COVERAGE_ITEM_LIMIT);
    const evict = (item: Item) => {
      item.evicted = true;
      item.parts.clear();
    };
    for (const item of ordered.slice(0, -COVERAGE_ITEM_LIMIT)) evict(item);
    const size = (item: Item) => {
      let count = 0;
      for (const part of item.parts.values()) {
        for (const _point of part.transcript ?? '') {
          if (++count > COVERAGE_CODE_POINT_LIMIT) return count;
        }
      }
      return count;
    };
    for (const item of items.values())
      if (size(item) > COVERAGE_CODE_POINT_LIMIT) evict(item);
    // Unordered finals wait without displacing known recent speech; overflow is permanently excluded.
    const waiting = [...items.values()].filter(
      (item) => !visited.has(item.itemId) && !item.evicted,
    );
    const budget = [...waiting, ...retained];
    let waitingCount = waiting.length;
    let total = budget.reduce((sum, item) => sum + size(item), 0);
    for (const item of budget) {
      if (
        total <= COVERAGE_CODE_POINT_LIMIT &&
        waitingCount <= COVERAGE_ITEM_LIMIT
      )
        break;
      total -= size(item);
      if (!visited.has(item.itemId)) waitingCount--;
      evict(item);
    }
    const next: CoverageEvidence = {
      takeId,
      connectionId,
      items: retained.map((item) => ({
        itemId: item.itemId,
        previousItemId: item.previousItemId ?? null,
        status: item.uncertain ? 'uncertain' : 'committed',
        parts: [...item.parts.values()]
          .sort((a, b) => a.contentIndex - b.contentIndex)
          .map((part) => ({ ...part })),
      })),
    };
    if (JSON.stringify(snapshot) !== JSON.stringify(next)) snapshot = next;
  }
  return {
    getSnapshot: () => snapshot,
    accept(input: TakeEvidence) {
      const { event } = input;
      let item = items.get(event.itemId);
      if (!item) {
        item = {
          itemId: event.itemId,
          committed: false,
          evicted: false,
          uncertain: false,
          parts: new Map(),
        };
        items.set(event.itemId, item);
      }
      if (input.type === 'committed') {
        if (
          item.committed &&
          item.previousItemId !== input.event.previousItemId
        )
          item.uncertain = true;
        else item.previousItemId = input.event.previousItemId;
        item.committed = true;
      } else if (!item.evicted) {
        const previousPart = item.parts.get(input.event.contentIndex);
        const nextPart: Part = {
          contentIndex: input.event.contentIndex,
          status: input.type === 'completed' ? 'final' : 'failed',
          ...(input.type === 'completed'
            ? { transcript: input.event.transcript }
            : {}),
        };
        if (
          previousPart &&
          JSON.stringify(previousPart) !== JSON.stringify(nextPart)
        ) {
          nextPart.status = 'uncertain';
          delete nextPart.transcript;
        }
        item.parts.set(input.event.contentIndex, nextPart);
      }
      reconcile();
    },
    clear() {
      items.clear();
      snapshot = { takeId, connectionId, items: [] };
    },
  };
}
