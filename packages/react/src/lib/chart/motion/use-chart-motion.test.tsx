import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import type { MotionRect } from './flip.js';
import { computeFlipDelta, enterKeyframes, flipKeyframes } from './flip.js';
import type { ResolvedChartMotionConfig } from './motion-config.js';
import { DEFAULT_MOTION } from './motion-config.js';
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
  return items
    .map(
      (item) =>
        `${item.id}:${item.rect.x},${item.rect.y},${item.rect.width},${item.rect.height}`,
    )
    .join('|');
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
  useChartMotion(
    containerRef,
    { layoutKey: layoutKey ?? signatureOf(items), sizeKey },
    motion,
  );
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

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
): MotionRect => ({ x, y, width, height });

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
      ({ rerender } = render(
        <Harness items={first} motion={DEFAULT_MOTION} />,
      ));
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
      ({ rerender } = render(
        <Harness items={first} motion={DEFAULT_MOTION} />,
      ));
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
      ({ rerender } = render(
        <Harness items={first} motion={DEFAULT_MOTION} />,
      ));
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

  it('cancels running animations on child nodes when motion is suppressed', () => {
    // A fake Animation list per node: `animate()` pushes onto it and
    // `cancel()` removes itself, mirroring real WAAPI semantics closely
    // enough to prove the suppression branch actually cancels the animation
    // rather than just skipping future ones.
    const liveAnimationsById = new Map<string, Array<{ cancel: () => void }>>();
    window.Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      const id = this.getAttribute('data-instance-id') ?? '';
      animateCalls.push({
        id,
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeAnimationOptions,
      });
      const list = liveAnimationsById.get(id) ?? [];
      const animation = {
        cancel: () => list.splice(list.indexOf(animation), 1),
      };
      list.push(animation);
      liveAnimationsById.set(id, list);
      return {
        ...animation,
        finished: Promise.resolve(),
      } as unknown as Animation;
    } as never;
    window.Element.prototype.getAnimations = function (this: Element) {
      const id = this.getAttribute('data-instance-id') ?? '';
      return (liveAnimationsById.get(id) ?? []) as unknown as Animation[];
    } as never;

    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [{ id: 'a', rect: rect(50, 20, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Harness items={first} motion={DEFAULT_MOTION} />,
      ));
    });

    // Trigger a FLIP so the child node has a running WAAPI animation.
    act(() => {
      rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
    });
    expect(animateCalls).toHaveLength(1);
    expect(liveAnimationsById.get('a')).toHaveLength(1);

    // Toggle motion to disabled only -- no layout/size key change.
    act(() => {
      rerender(
        <Harness
          items={second}
          motion={{ ...DEFAULT_MOTION, disabled: true }}
        />,
      );
    });

    expect(liveAnimationsById.get('a')).toHaveLength(0);
  });

  it('does not animate when motion is suppressed', () => {
    const disabled: ResolvedChartMotionConfig = {
      ...DEFAULT_MOTION,
      disabled: true,
    };
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
    const disabled: ResolvedChartMotionConfig = {
      ...DEFAULT_MOTION,
      disabled: true,
    };

    let rerender!: (ui: React.ReactElement) => void;

    // Pass 1: baseline measurement at rectA, no animation (first pass).
    act(() => {
      ({ rerender } = render(
        <Harness items={rectA} motion={DEFAULT_MOTION} />,
      ));
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
    const deltaFromFreshBaseline = computeFlipDelta(
      rectC[0]!.rect,
      rectD[0]!.rect,
    );
    const deltaFromStaleBaseline = computeFlipDelta(
      rectA[0]!.rect,
      rectD[0]!.rect,
    );
    expect(call.keyframes).toEqual(flipKeyframes(deltaFromFreshBaseline!));
    expect(call.keyframes).not.toEqual(flipKeyframes(deltaFromStaleBaseline!));
  });

  it('fires enter animations when an emptied board repopulates', () => {
    // "Never measured" and "board currently empty" are different states: a
    // cleared board must not reset motion to first-pass behavior, or the
    // vessels of the next layout appear with no enter animation.
    const populated: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const empty: Item[] = [];
    const repopulated: Item[] = [
      { id: 'b', rect: rect(0, 0, 100, 100) },
      { id: 'c', rect: rect(100, 0, 100, 100) },
    ];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Harness items={populated} motion={DEFAULT_MOTION} />,
      ));
    });
    act(() => {
      rerender(<Harness items={empty} motion={DEFAULT_MOTION} />);
    });
    expect(animateCalls).toHaveLength(0);

    act(() => {
      rerender(<Harness items={repopulated} motion={DEFAULT_MOTION} />);
    });

    expect(animateCalls).toHaveLength(2);
    for (const call of animateCalls) {
      expect(call.keyframes).toEqual(enterKeyframes());
    }
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
        <Harness
          items={initial}
          layoutKey="L1"
          sizeKey="800x600"
          motion={DEFAULT_MOTION}
        />,
      ));
    });

    // Size-only change: no animation, but the rect map must be refreshed.
    act(() => {
      rerender(
        <Harness
          items={resized}
          layoutKey="L1"
          sizeKey="1200x600"
          motion={DEFAULT_MOTION}
        />,
      );
    });
    expect(animateCalls).toHaveLength(0);

    // Layout change: FLIP baseline must be the POST-resize rect — proof the
    // size-only pass updated the map instead of skipping measurement.
    act(() => {
      rerender(
        <Harness
          items={moved}
          layoutKey="L2"
          sizeKey="1200x600"
          motion={DEFAULT_MOTION}
        />,
      );
    });

    expect(animateCalls).toHaveLength(1);
    const call = animateCalls[0]!;
    const deltaFromPostResize = computeFlipDelta(
      resized[0]!.rect,
      moved[0]!.rect,
    );
    const deltaFromPreResize = computeFlipDelta(
      initial[0]!.rect,
      moved[0]!.rect,
    );
    expect(call.keyframes).toEqual(flipKeyframes(deltaFromPostResize!));
    expect(call.keyframes).not.toEqual(flipKeyframes(deltaFromPreResize!));
  });

  it('degrades to no motion when Element.animate is unavailable instead of throwing', () => {
    // A runtime without WAAPI. A layoutKey change must skip animation, not
    // throw inside the layout effect — an uncaught error there would unmount
    // the Chart. The exit path already guards the same way.
    // @ts-expect-error simulating an environment without Element.animate
    window.Element.prototype.animate = undefined;

    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [{ id: 'a', rect: rect(50, 20, 100, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Harness items={first} motion={DEFAULT_MOTION} />,
      ));
    });

    expect(() => {
      act(() => {
        rerender(<Harness items={second} motion={DEFAULT_MOTION} />);
      });
    }).not.toThrow();
  });

  it('does not cancel a consumer overlay animation when motion is suppressed', () => {
    // Chart renders consumer `children` as direct siblings of vessel wrappers.
    // A spinner driving its own element.animate() must survive a reduced-motion
    // or disabled toggle — the suppression cancel walk targets only vessels.
    const liveByKey = new Map<string, Array<{ cancel: () => void }>>();
    const keyOf = (el: Element) =>
      el.getAttribute('data-instance-id') ??
      el.getAttribute('data-overlay') ??
      '';
    window.Element.prototype.animate = function (this: Element) {
      const key = keyOf(this);
      const list = liveByKey.get(key) ?? [];
      const animation = {
        cancel: () => list.splice(list.indexOf(animation), 1),
      };
      list.push(animation);
      liveByKey.set(key, list);
      return {
        ...animation,
        finished: Promise.resolve(),
      } as unknown as Animation;
    } as never;
    window.Element.prototype.getAnimations = function (this: Element) {
      return (liveByKey.get(keyOf(this)) ?? []) as unknown as Animation[];
    } as never;

    function OverlayHarness({ motion }: { motion: ResolvedChartMotionConfig }) {
      const containerRef = useRef<HTMLDivElement | null>(null);
      useChartMotion(
        containerRef,
        { layoutKey: 'L1', sizeKey: '800x600' },
        motion,
      );
      return (
        <div ref={containerRef}>
          <div
            data-instance-id="a"
            ref={(node) => {
              if (node) stubRect(node, rect(0, 0, 100, 100));
            }}
          />
          <div
            data-overlay="spinner"
            ref={(node) => {
              if (!node) return;
              stubRect(node, rect(0, 0, 10, 10));
              // Consumer-owned animation, seeded once (ref reattaches each render).
              if ((liveByKey.get('spinner') ?? []).length === 0)
                node.animate([], {});
            }}
          />
        </div>
      );
    }

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(<OverlayHarness motion={DEFAULT_MOTION} />));
    });
    expect(liveByKey.get('spinner')).toHaveLength(1);

    // Suppress motion (disabled), no layout/size change: suppression cancel walk runs.
    act(() => {
      rerender(
        <OverlayHarness motion={{ ...DEFAULT_MOTION, disabled: true }} />,
      );
    });

    expect(liveByKey.get('spinner')).toHaveLength(1);
  });

  it('still animates when the layout key and size key change in the same pass', () => {
    const first: Item[] = [{ id: 'a', rect: rect(0, 0, 100, 100) }];
    const second: Item[] = [{ id: 'a', rect: rect(50, 20, 120, 100) }];

    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      ({ rerender } = render(
        <Harness
          items={first}
          layoutKey="L1"
          sizeKey="800x600"
          motion={DEFAULT_MOTION}
        />,
      ));
    });

    act(() => {
      rerender(
        <Harness
          items={second}
          layoutKey="L2"
          sizeKey="1200x600"
          motion={DEFAULT_MOTION}
        />,
      );
    });

    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0]!.keyframes).toEqual(
      flipKeyframes(computeFlipDelta(first[0]!.rect, second[0]!.rect)!),
    );
  });
});
