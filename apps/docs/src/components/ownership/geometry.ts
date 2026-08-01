import type { OwnershipNode } from './types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `foreignObject` rect (top-left origin) for a node centered at its position. */
export function nodeRect(node: OwnershipNode): Rect {
  return {
    x: node.x - node.w / 2,
    y: node.y - node.h / 2,
    width: node.w,
    height: node.h,
  };
}

/**
 * Point where a ray from the node center toward (tx, ty) exits the node's box,
 * so a path anchors at the visible edge instead of disappearing under the card.
 */
export function anchor(node: OwnershipNode, tx: number, ty: number): Point {
  const dx = tx - node.x;
  const dy = ty - node.y;
  // Coincident target: the ray has no direction, so 0 * Infinity would produce a
  // NaN coordinate and malformed "M NaN,NaN" path data. Anchor at the center.
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const sx = dx === 0 ? Infinity : node.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : node.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: node.x + dx * s, y: node.y + dy * s };
}

/** Top-edge center, where an arc leaves a node on its way over the stage. */
export function topAnchor(node: OwnershipNode): Point {
  return { x: node.x, y: node.y - node.h / 2 };
}

function round(value: number): string {
  return value.toFixed(1);
}

export function straightPath(a: Point, b: Point): string {
  return `M${round(a.x)},${round(a.y)} L${round(b.x)},${round(b.y)}`;
}

/** Control point of the quadratic arc that carries a path over the stage. */
export function arcControl(a: Point, b: Point, lift: number): Point {
  return { x: (a.x + b.x) / 2, y: lift };
}

export function arcPath(a: Point, b: Point, lift: number): string {
  const c = arcControl(a, b, lift);
  return `M${round(a.x)},${round(a.y)} Q${round(c.x)},${round(c.y)} ${round(b.x)},${round(b.y)}`;
}

/**
 * Where to hang an edge's label: the midpoint of a straight run, or the apex of
 * an arc. A quadratic at t=0.5 sits halfway between the chord and the control
 * point, so it never reaches the control point itself.
 */
export function labelPoint(a: Point, b: Point, lift?: number): Point {
  if (lift === undefined) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  const c = arcControl(a, b, lift);
  return {
    x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x,
    y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y,
  };
}
