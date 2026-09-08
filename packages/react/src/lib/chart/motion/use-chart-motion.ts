import type { RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';
import type { MotionRect } from './flip.js';
import {
  computeFlipDelta,
  enterKeyframes,
  flipKeyframes,
  staggerOrder,
} from './flip.js';
import { measureInstances } from './measure.js';
import type { ResolvedChartMotionConfig } from './motion-config.js';
import { motionSuppressed } from './motion-config.js';

// The two keys are separate because they drive different responses.
// `layoutKey` is the logical layout — type plus per-instance placement — and a
// change to it animates. `sizeKey` is any input that moves rects without
// changing the logical layout; a change to it re-measures WITHOUT animating,
// because the browser has already reflowed instantly and FLIPping there
// rubber-bands the whole chart against that reflow during window drags.
export function useChartMotion(
  containerRef: RefObject<HTMLElement | null>,
  keys: { layoutKey: string; sizeKey: string },
  motion: ResolvedChartMotionConfig,
): void {
  const { layoutKey, sizeKey } = keys;

  const prevRectsRef = useRef<Map<string, MotionRect>>(new Map());
  const prevLayoutKeyRef = useRef<string | null>(null);
  // Tracks "has a non-empty board ever been measured", distinct from
  // prevRects.size: a board that empties and then repopulates must still
  // fire enter animations, whereas map emptiness alone would reset motion
  // to first-pass (silent) behavior.
  const hasMeasuredRef = useRef(false);

  // `suppressed` (not the whole `motion` object) is a dep so a disabled-only
  // toggle still fires this effect and cancels in-flight animations — but a
  // duration/easing/stagger-only change (suppressed unchanged) must not
  // re-trigger a measurement pass, matching the layoutKey/sizeKey contract
  // below. `motion` itself stays out of the deps and is read from the latest
  // render closure so a key change still sees the freshest values.
  const suppressed = motionSuppressed(motion);

  // biome-ignore lint/correctness/useExhaustiveDependencies: motion is read from the latest-render closure by design — a motion-only change must not retrigger measurement/animation; container ref access is intentional.
  useLayoutEffect(() => {
    const layoutChanged = layoutKey !== prevLayoutKeyRef.current;
    prevLayoutKeyRef.current = layoutKey;

    if (suppressed) {
      const container = containerRef.current;
      if (container) {
        // Only cancel vessel animations — a consumer overlay in Chart's
        // `children` (a spinner driving its own element.animate()) is a direct
        // sibling here and must not have its animation yanked by a
        // reduced-motion or disabled toggle.
        for (const child of Array.from(container.children)) {
          if (!child.getAttribute('data-instance-id')) continue;
          child.getAnimations?.().forEach((animation) => {
            animation.cancel();
          });
        }
      }
      // Also drop the measured flag so the first pass after unsuppression
      // rebuilds a fresh baseline silently instead of enter-animating
      // everything against the cleared map.
      prevRectsRef.current = new Map();
      hasMeasuredRef.current = false;
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const prevRects = prevRectsRef.current;
    const isFirstPass = !hasMeasuredRef.current;

    const measured = measureInstances(container);
    const nextRects = new Map<string, MotionRect>();
    const nodeById = new Map<string, HTMLElement>();
    for (const [id, instance] of measured) {
      nextRects.set(id, instance.rect);
      nodeById.set(id, instance.node);
    }

    prevRectsRef.current = nextRects;
    if (nextRects.size > 0) hasMeasuredRef.current = true;

    // Size-only pass: the map refresh above keeps the next layout change
    // FLIPping from post-resize positions, but nothing animates now.
    if (!layoutChanged) return;

    // Measure every node before touching any animation. getBoundingClientRect
    // on a node mid-FLIP reflects its current transform, so this is what lets
    // an interrupted animation re-FLIP continuously from where it visually
    // is instead of snapping to its resting layout position first.
    //
    // Each entry carries the rect it was measured from, so the stagger pass
    // below needs no second lookup into nextRects — and cannot miss one.
    const toAnimate: Array<{
      id: string;
      rect: MotionRect;
      keyframes: Keyframe[];
    }> = [];
    for (const [id, nextRect] of nextRects) {
      const prevRect = prevRects.get(id);
      if (prevRect) {
        const delta = computeFlipDelta(prevRect, nextRect);
        if (delta)
          toAnimate.push({
            id,
            rect: nextRect,
            keyframes: flipKeyframes(delta),
          });
      } else if (!isFirstPass) {
        toAnimate.push({ id, rect: nextRect, keyframes: enterKeyframes() });
      }
    }

    if (toAnimate.length > 0) {
      const order = staggerOrder(
        toAnimate.map(({ id, rect }) => [id, rect] as const),
      );
      const delayById = new Map(
        order.map((id, index) => [id, index * motion.staggerMs]),
      );

      for (const { id, keyframes } of toAnimate) {
        const node = nodeById.get(id);
        if (!node) continue;
        // Degrade to no motion where WAAPI is absent rather than throwing an
        // uncaught error inside this layout effect (which would unmount the
        // Chart) — the exit path guards the same way.
        if (typeof node.animate !== 'function') continue;
        node.getAnimations?.().forEach((animation) => {
          animation.cancel();
        });
        node.animate(keyframes, {
          duration: motion.durationMs,
          easing: motion.easing,
          delay: delayById.get(id) ?? 0,
          fill: 'backwards',
        });
      }
    }
  }, [layoutKey, sizeKey, suppressed]);
}
