import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { computeFlipDelta, enterKeyframes, flipKeyframes, staggerOrder } from './flip.js';
import type { MotionRect } from './flip.js';
import { motionSuppressed } from './motion-config.js';
import type { ResolvedChartMotionConfig } from './motion-config.js';

// `layoutKey` (logical layout: type + per-instance placement) and `sizeKey`
// (container pixel WxH) are deliberately separate params: on a size-only
// change the browser has already reflowed `1fr` tracks instantly, so the
// rect map must be re-measured WITHOUT animating — FLIPping there
// rubber-bands the whole grid against the instant reflow during window
// drags. Only a layoutKey change animates.
export function useChartMotion(
  containerRef: RefObject<HTMLElement | null>,
  layoutKey: string,
  sizeKey: string,
  motion: ResolvedChartMotionConfig,
): void {
  const prevRectsRef = useRef<Map<string, MotionRect>>(new Map());
  const prevLayoutKeyRef = useRef<string | null>(null);

  // Deps are the two keys only — unlike useExitingInstances, which keys its
  // effect on `[signature, motion]`, `motion` here is read from the latest
  // render closure. A motion config change alone must not re-trigger a
  // measurement pass (there is nothing new to animate), but when a key
  // change fires the effect it still sees the freshest duration/easing/
  // stagger values.
  useLayoutEffect(() => {
    const layoutChanged = layoutKey !== prevLayoutKeyRef.current;
    prevLayoutKeyRef.current = layoutKey;

    if (motionSuppressed(motion)) {
      prevRectsRef.current = new Map();
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const prevRects = prevRectsRef.current;
    const isFirstPass = prevRects.size === 0;
    const containerRect = container.getBoundingClientRect();

    const nextRects = new Map<string, MotionRect>();
    const nodeById = new Map<string, HTMLElement>();
    for (const child of Array.from(container.children)) {
      const id = child.getAttribute('data-instance-id');
      if (!id) continue;
      const node = child as HTMLElement;
      const rect = node.getBoundingClientRect();
      nextRects.set(id, {
        x: rect.x - containerRect.x,
        y: rect.y - containerRect.y,
        width: rect.width,
        height: rect.height,
      });
      nodeById.set(id, node);
    }

    prevRectsRef.current = nextRects;

    // Size-only pass: the map refresh above keeps the next layout change
    // FLIPping from post-resize positions, but nothing animates now.
    if (!layoutChanged) return;

    // Measure every node before touching any animation. getBoundingClientRect
    // on a node mid-FLIP reflects its current transform, so this is what lets
    // an interrupted animation re-FLIP continuously from where it visually
    // is instead of snapping to its resting layout position first.
    const toAnimate: Array<{ id: string; keyframes: Keyframe[] }> = [];
    for (const [id, nextRect] of nextRects) {
      const prevRect = prevRects.get(id);
      if (prevRect) {
        const delta = computeFlipDelta(prevRect, nextRect);
        if (delta) toAnimate.push({ id, keyframes: flipKeyframes(delta) });
      } else if (!isFirstPass) {
        toAnimate.push({ id, keyframes: enterKeyframes() });
      }
    }

    if (toAnimate.length > 0) {
      const order = staggerOrder(toAnimate.map(({ id }) => [id, nextRects.get(id)!] as const));
      const delayById = new Map(order.map((id, index) => [id, index * motion.staggerMs]));

      for (const { id, keyframes } of toAnimate) {
        const node = nodeById.get(id);
        if (!node) continue;
        node.getAnimations?.().forEach((animation) => animation.cancel());
        node.animate(keyframes, {
          duration: motion.durationMs,
          easing: motion.easing,
          delay: delayById.get(id) ?? 0,
          fill: 'backwards',
        });
      }
    }
  }, [layoutKey, sizeKey]);
}
