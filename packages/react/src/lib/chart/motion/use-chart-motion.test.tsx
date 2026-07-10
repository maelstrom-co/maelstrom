import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';

import { computeFlipDelta, enterKeyframes, flipKeyframes } from './flip.js';
import type { MotionRect } from './flip.js';
import { DEFAULT_MOTION } from './motion-config.js';
import type { ResolvedChartMotionConfig } from './motion-config.js';
import { useChartMotion } from './use-chart-motion.js';

interface AnimateCall {
  id: string | null;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

let animateCalls: AnimateCall[] = [];

beforeEach(() => {
  animateCalls = [];
  // happy-dom's Window is rebuilt per test (see __tests__/setup.ts) and isn't
  // spliced onto the Node global scope, so `Element` must come from `window`.
  window.Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    animateCalls.push({
      id: this.getAttribute('data-instance-id'),
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
    });
    return { cancel() {}, finished: Promise.resolve() } as unknown as Animation;
  } as never;
});

afterEach(() => cleanup());

interface Item {
  id: string;
  rect: MotionRect;
}

function signatureOf(items: Item[]): string {
  return items.map((item) => `${item.id}:${item.rect.x},${item.rect.y},${item.rect.width},${item.rect.height}`).join('|');
}

function Harness({
  items,
  motion,
  layoutKey,
  sizeKey = '800x600',
}: {
  items: Item[];
  motion: ResolvedChartMotionConfig;
  layoutKey?: string;
  sizeKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useChartMotion(containerRef, layoutKey ?? signatureOf(items), sizeKey, motion);
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

describe('useChartMotion', () => {
  it('does not animate on the first measurement pass', () => {
    const items: Item[] = [
      { id: 'a', rect: rect(0, 0, 100, 100) },
      { id: 'b', rect: rect(100, 0, 100, 100) },
    ];

    act(() => {
      render(<Harness items={items} motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(0);
  });

  it('FLIPs a moved node with the exact inverted keyframe from computeFlipDelta', () => {
    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [{ id: 'a', rect: rect(50, 20, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });

    act(() => {
      rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(1);
    const call = animateCalls[0]!;
    expect(call.id).toBe('a');
    const expectedDelta = computeFlipDelta(first[0]!.rect, second[0]!.rect);
    expect(expectedDelta).not.toBeNull();
    expect(call.keyframes).toEqual(flipKeyframes(expectedDelta!));
    expect(call.options.duration).toBe(DEFAULT_MOTION.durationMs);
    expect(call.options.easing).toBe(DEFAULT_MOTION.easing);
    expect(call.options.delay).toBe(0);
    expect(call.options.fill).toBe('backwards');
  });

  it('enters a newly added node once the rect map is non-empty', () => {
    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [
      { id: 'a', rect: rect(0, 0, 100, 100) },
      { id: 'b', rect: rect(100, 0, 100, 100) },
    ];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });

    act(() => {
      rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(1);
    const call = animateCalls[0]!;
    expect(call.id).toBe('b');
    expect(call.keyframes).toEqual(enterKeyframes());
  });

  it('orders stagger delays in reading order among the animated ids', () => {
    const first: Item[] = [
      { id: 'a', rect: rect(0, 0, 100, 100) },
      { id: 'b', rect: rect(100, 0, 100, 100) },
      { id: 'c', rect: rect(200, 0, 100, 100) },
    ];
    // c moves left of a, b unchanged, a moves right past b's slot.
    const second: Item[] = [
      { id: 'a', rect: rect(100, 0, 100, 100) },
      { id: 'b', rect: rect(100, 0, 100, 100) },
      { id: 'c', rect: rect(0, 0, 100, 100) },
    ];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={DEFAULT_MOTION} />));
    });

    act(() => {
      rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
    });

    // a and b are unchanged in absolute rect terms... actually a moved (0,0->100,0) and c moved (200,0->0,0); b unchanged.
    expect(animateCalls).toHaveLength(2);
    const byId = new Map(animateCalls.map((call) => [call.id, call]));
    const cCall = byId.get('c')!;
    const aCall = byId.get('a')!;
    // Reading order (by next rect x): c ends at x=0, a ends at x=100.
    expect(cCall.options.delay).toBe(0);
    expect(aCall.options.delay).toBe(DEFAULT_MOTION.staggerMs);
  });

  it('does not animate when motion is suppressed', () => {
    const disabled: ResolvedChartMotionConfig = { ...DEFAULT_MOTION, disabled: true };
    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [{ id: 'a', rect: rect(50, 20, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<Harness items={first} motion={disabled} />));
    });

    act(() => {
      rerender(<Harness items={second} motion={disabled} />);
    });

    expect(animateCalls).toHaveLength(0);
  });

  it('resets the rect map under suppression so the next pass has no stale FLIP baseline', () => {
    const rectA: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const rectB: Item[] = [{ id: 'a', rect: rect(50, 20, 100, 100) }];
    const rectC: Item[] = [{ id: 'a', rect: rect(70, 10, 100, 100) }];
    const rectD: Item[] = [{ id: 'a', rect: rect(120, 60, 100, 100) }];
    const disabled: ResolvedChartMotionConfig = { ...DEFAULT_MOTION, disabled: true };

    let rerender!: (ui: React.ReactElement) => void;

    // Pass 1: baseline measurement at rectA, no animation (first pass).
    act(() => {
      ({ rerender } = render(<Harness items={rectA} motion={DEFAULT_MOTION} />));
    });
    expect(animateCalls).toHaveLength(0);

    // Pass 2: suppressed while moving to rectB. No animation, map cleared.
    act(() => {
      rerender(<Harness items={rectB} motion={disabled} />);
    });
    expect(animateCalls).toHaveLength(0);

    // Pass 3: unsuppressed, moving to rectC. If the map were still holding
    // rectA (i.e. suppression did NOT reset it), this would incorrectly FLIP
    // from rectA to rectC. Because the map was cleared, this is instead
    // treated as a fresh first pass -- no animation, rectC becomes the baseline.
    act(() => {
      rerender(<Harness items={rectC} motion={DEFAULT_MOTION} />);
    });
    expect(animateCalls).toHaveLength(0);

    // Pass 4: move to rectD. FLIP must be computed from rectC (the fresh
    // baseline established in pass 3), not the stale pre-suppression rectA.
    act(() => {
      rerender(<Harness items={rectD} motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(1);
    const call = animateCalls[0]!;
    const deltaFromFreshBaseline = computeFlipDelta(rectC[0]!.rect, rectD[0]!.rect);
    const deltaFromStaleBaseline = computeFlipDelta(rectA[0]!.rect, rectD[0]!.rect);
    expect(call.keyframes).toEqual(flipKeyframes(deltaFromFreshBaseline!));
    expect(call.keyframes).not.toEqual(flipKeyframes(deltaFromStaleBaseline!));
  });

  it('re-measures without animating on a size-only change, then FLIPs from the post-resize rect', () => {
    // A window drag: the browser instantly reflows `1fr` tracks, so rects
    // change while the logical layout (layoutKey) stays the same. Animating
    // here would rubber-band against the instant reflow.
    const initial: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const resized: Item[] = [{ id: 'a', rect: rect(0, 0, 150, 100) }];
    const moved: Item[] = [{ id: 'a', rect: rect(50, 30, 150, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Harness items={initial} layoutKey="L1" sizeKey="800x600" motion={DEFAULT_MOTION} />,
      ));
    });

    // Size-only change: no animation, but the rect map must be refreshed.
    act(() => {
      rerender(<Harness items={resized} layoutKey="L1" sizeKey="1200x600" motion={DEFAULT_MOTION} />);
    });
    expect(animateCalls).toHaveLength(0);

    // Layout change: FLIP baseline must be the POST-resize rect — proof the
    // size-only pass updated the map instead of skipping measurement.
    act(() => {
      rerender(<Harness items={moved} layoutKey="L2" sizeKey="1200x600" motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(1);
    const call = animateCalls[0]!;
    const deltaFromPostResize = computeFlipDelta(resized[0]!.rect, moved[0]!.rect);
    const deltaFromPreResize = computeFlipDelta(initial[0]!.rect, moved[0]!.rect);
    expect(call.keyframes).toEqual(flipKeyframes(deltaFromPostResize!));
    expect(call.keyframes).not.toEqual(flipKeyframes(deltaFromPreResize!));
  });

  it('still animates when the layout key and size key change in the same pass', () => {
    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [{ id: 'a', rect: rect(50, 20, 120, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Harness items={first} layoutKey="L1" sizeKey="800x600" motion={DEFAULT_MOTION} />,
      ));
    });

    act(() => {
      rerender(<Harness items={second} layoutKey="L2" sizeKey="1200x600" motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0]!.keyframes).toEqual(
      flipKeyframes(computeFlipDelta(first[0]!.rect, second[0]!.rect)!),
    );
  });
});
