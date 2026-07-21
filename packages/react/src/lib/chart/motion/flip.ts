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
// Scale ratios live on a much tighter unit-relative band than pixel deltas.
const SCALE_EPSILON = POSITION_EPSILON / 100;
const ROW_EPSILON = 8;

export function computeFlipDelta(prev: MotionRect, next: MotionRect): FlipDelta | null {
  // A zero-sized rect on either side would scale to/from zero, flashing
  // instead of animating, so skip the FLIP transform entirely.
  if (next.width <= 0 || next.height <= 0) return null;
  if (prev.width <= 0 || prev.height <= 0) return null;
  const dx = prev.x - next.x;
  const dy = prev.y - next.y;
  const sx = prev.width / next.width;
  const sy = prev.height / next.height;
  const unchanged =
    Math.abs(dx) < POSITION_EPSILON &&
    Math.abs(dy) < POSITION_EPSILON &&
    Math.abs(sx - 1) < SCALE_EPSILON &&
    Math.abs(sy - 1) < SCALE_EPSILON;
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
// The row is quantized to a bucket up front rather than compared with an
// epsilon inside the comparator: an epsilon-band "same row, else compare y"
// comparator is non-transitive (A~B, B~C within the band but A and C are not),
// and Array.sort with a non-transitive comparator is implementation-defined —
// so tiling layouts could stagger in an order that differs between engines.
export function staggerOrder(rects: ReadonlyArray<readonly [string, MotionRect]>): string[] {
  const rowKey = (y: number) => Math.floor(y / ROW_EPSILON);
  return [...rects]
    .sort(([, a], [, b]) => {
      const rowDiff = rowKey(a.y) - rowKey(b.y);
      if (rowDiff !== 0) return rowDiff;
      return a.x - b.x;
    })
    .map(([id]) => id);
}
