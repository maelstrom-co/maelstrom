import { describe, expect, it } from 'bun:test';

import type { MotionRect } from './flip.js';
import { measureInstanceRects, measureInstances } from './measure.js';

function stubRect(node: HTMLElement, rect: MotionRect) {
  node.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON() {
        return {};
      },
    }) as DOMRect;
}

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
): MotionRect => ({ x, y, width, height });

function makeContainer(
  children: Array<{ id?: string; rect: MotionRect }>,
): HTMLElement {
  const container = document.createElement('div');
  stubRect(container, rect(10, 20, 800, 600));
  for (const child of children) {
    const node = document.createElement('div');
    if (child.id) node.setAttribute('data-instance-id', child.id);
    // Rects are stubbed in absolute (viewport) space; the helper subtracts the
    // container origin, so add it here to assert the container-relative result.
    stubRect(
      node,
      rect(
        child.rect.x + 10,
        child.rect.y + 20,
        child.rect.width,
        child.rect.height,
      ),
    );
    container.appendChild(node);
  }
  return container;
}

describe('measureInstances', () => {
  it('returns each instance node keyed by id with a container-relative rect', () => {
    const container = makeContainer([
      { id: 'a', rect: rect(0, 0, 100, 100) },
      { id: 'b', rect: rect(100, 0, 200, 50) },
    ]);

    const measured = measureInstances(container);

    expect([...measured.keys()]).toEqual(['a', 'b']);
    expect(measured.get('a')?.rect).toEqual(rect(0, 0, 100, 100));
    expect(measured.get('b')?.rect).toEqual(rect(100, 0, 200, 50));
    expect(measured.get('a')?.node).toBe(container.children[0] as HTMLElement);
  });

  it('skips children without a data-instance-id (consumer overlays)', () => {
    const container = makeContainer([
      { id: 'a', rect: rect(0, 0, 100, 100) },
      { rect: rect(0, 0, 10, 10) }, // consumer overlay: no id
    ]);

    const measured = measureInstances(container);

    expect([...measured.keys()]).toEqual(['a']);
  });

  it('skips children carrying data-exiting even though they carry data-instance-id', () => {
    // Exit ghosts render from the same VesselRenderer as live instances, so
    // they DO carry data-instance-id — data-exiting is what tells this walk
    // to treat them as a ghost rather than a live instance, so a fading-out
    // instance doesn't corrupt the FLIP rect map or exit/enter detection.
    const container = makeContainer([
      { id: 'a', rect: rect(0, 0, 100, 100) },
      { id: 'b', rect: rect(100, 0, 200, 50) },
    ]);
    const ghost = container.children[1] as HTMLElement;
    ghost.setAttribute('data-exiting', '');

    const measured = measureInstances(container);

    expect([...measured.keys()]).toEqual(['a']);
  });
});

describe('measureInstanceRects', () => {
  it('is the rect-only view of the same walk', () => {
    const container = makeContainer([{ id: 'a', rect: rect(5, 6, 100, 100) }]);

    const rects = measureInstanceRects(container);

    expect([...rects.keys()]).toEqual(['a']);
    expect(rects.get('a')).toEqual(rect(5, 6, 100, 100));
  });
});
