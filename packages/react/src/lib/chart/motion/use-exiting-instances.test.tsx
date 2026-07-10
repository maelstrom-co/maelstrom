import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import FakeTimers from '@sinonjs/fake-timers';
import { useRef } from 'react';

import type { MotionRect } from './flip.js';
import { DEFAULT_MOTION } from './motion-config.js';
import type { ResolvedChartMotionConfig } from './motion-config.js';
import { useExitingInstances } from './use-exiting-instances.js';
import type { ExitingEntry } from './use-exiting-instances.js';

afterEach(() => cleanup());

interface Item {
  id: string;
  label: string;
  rect: MotionRect;
}

function signatureOf(items: Item[]): string {
  return items.map((item) => `${item.id}:${item.rect.x},${item.rect.y},${item.rect.width},${item.rect.height}`).join('|');
}

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

const rect = (x: number, y: number, width: number, height: number): MotionRect => ({ x, y, width, height });

let capturedEntries: ReadonlyArray<ExitingEntry<Item>> = [];
let measureCallCount = 0;

beforeEach(() => {
  capturedEntries = [];
  measureCallCount = 0;
});

// Walks container.children + hasAttribute instead of an attribute-selector
// querySelectorAll, which throws under this repo's bun+happy-dom combo
// (documented in use-chart-motion.test.tsx).
function Harness({ items, motion }: { items: Item[]; motion: ResolvedChartMotionConfig }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const measureRect = (id: string): MotionRect | null => {
    measureCallCount += 1;
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    for (const child of Array.from(container.children)) {
      const node = child as HTMLElement;
      if (node.getAttribute('data-instance-id') !== id) continue;
      const r = node.getBoundingClientRect();
      return { x: r.x - containerRect.x, y: r.y - containerRect.y, width: r.width, height: r.height };
    }
    return null;
  };

  const current = items.map((item) => [item.id, item] as const);
  capturedEntries = useExitingInstances(current, measureRect, motion, signatureOf(items));

  return (
    <div ref={containerRef}>
      {items.map((item) => (
        <div
          key={item.id}
          data-instance-id={item.id}
          ref={(node) => {
            if (node) stubRect(node, item.rect);
          }}
        />
      ))}
    </div>
  );
}

describe('useExitingInstances', () => {
  it('exposes an exiting entry with the last-snapshotted rect when an id disappears', () => {
    const first: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];
    const second: Item[] = [{ id: 'a', label: 'A', rect: rect(0, 0, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });
    expect(capturedEntries).toHaveLength(0);

    act(() => {
      rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0]!;
    expect(entry.id).toBe('b');
    expect(entry.item).toEqual(first[1]!);
    expect(entry.rect).toEqual(rect(100, 0, 100, 100));
  });

  it('auto-removes an exiting entry durationMs + buffer after it appears', () => {
    const clock = FakeTimers.install();
    try {
      const first: Item[] = [
        { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
        { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
      ];
      const second: Item[] = [{ id: 'a', label: 'A', rect: rect(0, 0, 100, 100) }];

      let rerender!: (ui: React.ReactElement) => void;
      act(() => {
        ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
      });
      act(() => {
        rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
      });
      expect(capturedEntries).toHaveLength(1);

      // Just shy of the durationMs + 100 buffer: still present.
      act(() => {
        clock.tick(DEFAULT_MOTION.durationMs + 99);
      });
      expect(capturedEntries).toHaveLength(1);

      act(() => {
        clock.tick(1);
      });
      expect(capturedEntries).toHaveLength(0);
    } finally {
      clock.uninstall();
    }
  });

  it('cancels the exit when a removed id is re-added before its timer fires', () => {
    const clock = FakeTimers.install();
    try {
      const first: Item[] = [
        { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
        { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
      ];
      const withoutB: Item[] = [{ id: 'a', label: 'A', rect: rect(0, 0, 100, 100) }];
      const bRestored: Item[] = [
        { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
        { id: 'b', label: 'B', rect: rect(120, 0, 100, 100) },
      ];

      let rerender!: (ui: React.ReactElement) => void;
      act(() => {
        ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
      });
      act(() => {
        rerender(<Harness items={withoutB} motion={DEFAULT_MOTION} />);
      });
      expect(capturedEntries).toHaveLength(1);

      act(() => {
        rerender(<Harness items={bRestored} motion={DEFAULT_MOTION} />);
      });
      expect(capturedEntries).toHaveLength(0);

      // The cancelled timer must not fire a spurious removal later.
      act(() => {
        clock.tick(DEFAULT_MOTION.durationMs + 200);
      });
      expect(capturedEntries).toHaveLength(0);
    } finally {
      clock.uninstall();
    }
  });

  it('returns no entries and clears pending exits when motion is suppressed', () => {
    const disabled: ResolvedChartMotionConfig = { ...DEFAULT_MOTION, disabled: true };
    const first: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];
    const second: Item[] = [{ id: 'a', label: 'A', rect: rect(0, 0, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });
    act(() => {
      rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
    });
    expect(capturedEntries).toHaveLength(1);

    act(() => {
      rerender(<Harness items={second} motion={disabled} />);
    });
    expect(capturedEntries).toHaveLength(0);
  });

  it('preserves the pre-suppression rect for an id removed right after unsuppression', () => {
    const disabled: ResolvedChartMotionConfig = { ...DEFAULT_MOTION, disabled: true };
    const first: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];
    const withoutB: Item[] = [{ id: 'a', label: 'A', rect: rect(0, 0, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });

    // Suppress motion while both ids are still present -- a snapshot exists for b.
    act(() => {
      rerender(<Harness items={first} motion={disabled} />);
    });
    expect(capturedEntries).toHaveLength(0);

    // Same transition back to active motion also removes b: there is no live
    // node left to measure, so the entry must come from the pre-suppression
    // snapshot rather than being dropped.
    act(() => {
      rerender(<Harness items={withoutB} motion={DEFAULT_MOTION} />);
    });

    expect(capturedEntries).toHaveLength(1);
    const entry = capturedEntries[0]!;
    expect(entry.id).toBe('b');
    expect(entry.rect).toEqual(rect(100, 0, 100, 100));
  });

  it('does not re-measure when re-rendering with an identical layout signature', () => {
    const first: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });
    expect(measureCallCount).toBeGreaterThan(0);
    measureCallCount = 0;

    // A brand-new `items`/`current` array with the identical ids and rects --
    // same signature -- must not re-trigger the measuring pass.
    const sameShape: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];
    act(() => {
      rerender(<Harness items={sameShape} motion={DEFAULT_MOTION} />);
    });

    expect(measureCallCount).toBe(0);
  });
});
