import type { MotionRect } from './flip.js';

export interface MeasuredInstance {
  readonly node: HTMLElement;
  readonly rect: MotionRect;
}

// Single walk of `container.children`, matching `data-instance-id` nodes and
// computing each rect relative to the container. An attribute-selector
// querySelector throws under this repo's bun+happy-dom combo, so the FLIP
// baseline and the exit-ghost snapshots share this children walk rather than
// each re-deriving it (and drifting). Consumer `children` carry no id and are
// skipped here; exit ghosts DO carry `data-instance-id` (their renderer is now
// the same directly-mounted node as a live instance, not a wrapped
// grandchild), so they're excluded explicitly via `data-exiting` instead —
// otherwise a ghost would be measured as if it were a live instance and
// corrupt the FLIP rect map.
export function measureInstances(container: HTMLElement): Map<string, MeasuredInstance> {
  const containerBox = container.getBoundingClientRect();
  const measured = new Map<string, MeasuredInstance>();
  for (const child of Array.from(container.children)) {
    const id = child.getAttribute('data-instance-id');
    if (!id) continue;
    if (child.hasAttribute('data-exiting')) continue;
    const node = child as HTMLElement;
    const r = node.getBoundingClientRect();
    measured.set(id, {
      node,
      rect: {
        x: r.x - containerBox.x,
        y: r.y - containerBox.y,
        width: r.width,
        height: r.height,
      },
    });
  }
  return measured;
}

// Rect-only view of the single walk above, for callers that don't need the
// node handles (exit tracking looks ids up in this map instead of measuring
// each one — a per-id walk is O(n²) with forced reflows on every layout change).
export function measureInstanceRects(container: HTMLElement): Map<string, MotionRect> {
  const rects = new Map<string, MotionRect>();
  for (const [id, { rect }] of measureInstances(container)) rects.set(id, rect);
  return rects;
}
