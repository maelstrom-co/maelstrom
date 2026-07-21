import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import FakeTimers from '@sinonjs/fake-timers';
import { StrictMode, useRef } from 'react';

import type { MotionRect } from './flip.js';
import { DEFAULT_MOTION, EXIT_CLEANUP_BUFFER_MS } from './motion-config.js';
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
// (documented in use-chart-motion.test.tsx). One batch walk per call —
// measureCallCount counts calls, so a single layout change is one measure.
function Harness({ items, motion }: { items: Item[]; motion: ResolvedChartMotionConfig }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const measureRects = (): ReadonlyMap<string, MotionRect> => {
    measureCallCount += 1;
    const container = containerRef.current;
    if (!container) return new Map();
    const containerRect = container.getBoundingClientRect();
    const rects = new Map<string, MotionRect>();
    for (const child of Array.from(container.children)) {
      const node = child as HTMLElement;
      const id = node.getAttribute('data-instance-id');
      if (!id) continue;
      const r = node.getBoundingClientRect();
      rects.set(id, { x: r.x - containerRect.x, y: r.y - containerRect.y, width: r.width, height: r.height });
    }
    return rects;
  };

  const current = items.map((item) => [item.id, item] as const);
  capturedEntries = useExitingInstances(current, measureRects, motion, signatureOf(items));

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

  it('renders the exit ghost with the latest item data after a same-signature variant change', () => {
    // The signature is layoutKey@sizeKey and does not encode variant/props, so
    // a variant change with identical rects must not leave a stale cached
    // item -- a later removal should exit with the LATEST data, not the data
    // from whenever the signature last changed.
    const original: Item = { id: 'a', label: 'original', rect: rect(0, 0, 100, 100) };
    const updated: Item = { id: 'a', label: 'updated', rect: rect(0, 0, 100, 100) };
    const gone: Item[] = [];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={[original]} motion={DEFAULT_MOTION} />));
    });

    // Same signature (identical id/rect) -- only the label (item data) changes.
    act(() => {
      rerender(<Harness items={[updated]} motion={DEFAULT_MOTION} />);
    });

    act(() => {
      rerender(<Harness items={gone} motion={DEFAULT_MOTION} />);
    });

    expect(capturedEntries).toHaveLength(1);
    expect(capturedEntries[0]!.item).toEqual(updated);
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

      // Just shy of the durationMs + buffer: still present.
      act(() => {
        clock.tick(DEFAULT_MOTION.durationMs + EXIT_CLEANUP_BUFFER_MS - 1);
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

  it('does not re-measure when the motion object identity changes but its value is equal', () => {
    // resolveMotionConfig returns a fresh object every render; keying the effect
    // on that identity would re-fire on unrelated Provider re-renders and could
    // snapshot mid-FLIP rects into lastRects. The effect must key on the derived
    // suppressed boolean, so an equal-value motion of new identity is a no-op.
    const first: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });
    measureCallCount = 0;

    act(() => {
      rerender(<Harness items={first} motion={{ ...DEFAULT_MOTION }} />);
    });

    expect(measureCallCount).toBe(0);
  });

  it('measures the container in a single batch per layout change, not once per instance', () => {
    // The old path called measureRect(id) for every current id — O(n²) forced
    // reflows during the FLIP it's meant to smooth. One batch walk replaces it.
    const many: Item[] = Array.from({ length: 5 }, (_, i) => ({
      id: `v${i}`,
      label: `V${i}`,
      rect: rect(i * 20, 0, 20, 20),
    }));

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={many} motion={DEFAULT_MOTION} />));
    });
    measureCallCount = 0;

    const moved: Item[] = many.map((m) => ({ ...m, rect: rect(m.rect.x, 40, 20, 20) }));
    act(() => {
      rerender(<Harness items={moved} motion={DEFAULT_MOTION} />);
    });

    expect(measureCallCount).toBe(1);
  });

  it('detects exits correctly when the component is double-rendered', () => {
    // Exit detection runs during render (so the dropped instance is reported as
    // exiting in the SAME commit that removes it from the live layout — that is
    // what keeps its component mounted). Render-phase work must therefore be
    // idempotent: StrictMode invokes the render twice, and a second pass that
    // re-ran detection against its own already-updated bookkeeping would drop
    // the exit entirely or duplicate it.
    const first: Item[] = [
      { id: 'a', label: 'A', rect: rect(0, 0, 100, 100) },
      { id: 'b', label: 'B', rect: rect(100, 0, 100, 100) },
    ];
    const second: Item[] = [{ id: 'a', label: 'A', rect: rect(0, 0, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <StrictMode>
          <Harness items={first} motion={DEFAULT_MOTION} />
        </StrictMode>,
      ));
    });

    act(() => {
      rerender(
        <StrictMode>
          <Harness items={second} motion={DEFAULT_MOTION} />
        </StrictMode>,
      );
    });

    expect(capturedEntries.map((entry) => entry.id)).toEqual(['b']);
    expect(capturedEntries[0]!.rect).toEqual(rect(100, 0, 100, 100));
  });
});
