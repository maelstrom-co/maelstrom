export interface MotionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FlipDelta {
  readonly dx: number;
  readonly dy: number;
  readonly sx: number;
  readonly sy: number;
}

const POSITION_EPSILON = 0.5;
const ROW_EPSILON = 8;

export function computeFlipDelta(prev: MotionRect, next: MotionRect): FlipDelta | null {
  if (next.width <= 0 || next.height <= 0) return null;
  const dx = prev.x - next.x;
  const dy = prev.y - next.y;
  const sx = prev.width / next.width;
  const sy = prev.height / next.height;
  const unchanged =
    Math.abs(dx) < POSITION_EPSILON &&
    Math.abs(dy) < POSITION_EPSILON &&
    Math.abs(sx - 1) < POSITION_EPSILON / 100 &&
    Math.abs(sy - 1) < POSITION_EPSILON / 100;
  return unchanged ? null : { dx, dy, sx, sy };
}

export function flipKeyframes(delta: FlipDelta): Keyframe[] {
  return [
    {
      transform: `translate(${delta.dx}px, ${delta.dy}px) scale(${delta.sx}, ${delta.sy})`,
      transformOrigin: 'top left',
    },
    { transform: 'none', transformOrigin: 'top left' },
  ];
}

export function enterKeyframes(): Keyframe[] {
  return [
    { opacity: 0, transform: 'scale(0.96)' },
    { opacity: 1, transform: 'none' },
  ];
}

export function exitKeyframes(): Keyframe[] {
  return [
    { opacity: 1, transform: 'none' },
    { opacity: 0, transform: 'scale(0.96)' },
  ];
}

// Stagger reads as a wave when it follows reading order; row-major with a
// tolerance band keeps grid rows that differ by sub-cell pixels together.
export function staggerOrder(rects: ReadonlyArray<readonly [string, MotionRect]>): string[] {
  return [...rects]
    .sort(([, a], [, b]) => {
      const rowDiff = a.y - b.y;
      if (Math.abs(rowDiff) > ROW_EPSILON) return rowDiff;
      return a.x - b.x;
    })
    .map(([id]) => id);
}
