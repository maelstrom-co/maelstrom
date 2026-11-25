import type { LiveCaptureCompleted, LiveCaptureDelta } from './live-capture';

export interface TranscriptPart {
  readonly itemId: string;
  readonly contentIndex: number;
  readonly text: string;
  readonly status: 'draft' | 'final';
}

const ITEM_LIMIT = 4;
const CODE_POINT_LIMIT = 8000;

// Arrival order is display-only. Identity tombstones prevent evicted speech from
// reappearing; they contain no text and live only until this take is cleared.
export function createLiveTranscript() {
  const items = new Map<string, Map<number, TranscriptPart>>();
  const evicted = new Set<string>();
  let snapshot: readonly TranscriptPart[] = [];
  return {
    getSnapshot: () => snapshot,
    accept(event: LiveCaptureDelta | LiveCaptureCompleted) {
      if (evicted.has(event.itemId)) return;
      let parts = items.get(event.itemId);
      const previous = parts?.get(event.contentIndex);
      if ('delta' in event && (!event.delta || previous?.status === 'final'))
        return;
      const next: TranscriptPart = {
        itemId: event.itemId,
        contentIndex: event.contentIndex,
        text:
          'delta' in event
            ? (previous?.text ?? '') + event.delta
            : event.transcript,
        status: 'delta' in event ? 'draft' : 'final',
      };
      if (previous?.text === next.text && previous.status === next.status)
        return;
      if (!parts) {
        parts = new Map();
        items.set(event.itemId, parts);
      }
      parts.set(event.contentIndex, next);
      if (items.size > ITEM_LIMIT) {
        const oldest = items.keys().next();
        if (!oldest.done) {
          items.delete(oldest.value);
          evicted.add(oldest.value);
        }
      }
      const ordered = [...items.values()].flatMap((parts) =>
        [...parts.values()]
          .sort((a, b) => a.contentIndex - b.contentIndex)
          .map((part) => ({ parts, part })),
      );
      const updated: TranscriptPart[] = [];
      let remaining = CODE_POINT_LIMIT;
      for (const { parts, part } of ordered.reverse()) {
        const points = [...part.text];
        const text = points
          .slice(Math.max(0, points.length - remaining))
          .join('');
        remaining -= Math.min(points.length, remaining);
        const retained = text === part.text ? part : { ...part, text };
        parts.set(part.contentIndex, retained);
        if (text.length > 0) updated.unshift(retained);
      }
      if (JSON.stringify(snapshot) !== JSON.stringify(updated))
        snapshot = updated;
    },
    clear() {
      items.clear();
      evicted.clear();
      snapshot = [];
    },
  };
}
