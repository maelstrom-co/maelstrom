import type { LoopStep } from './loop-machine';

/**
 * Fixed-coordinate stage for the architecture diagram. Node positions and beam
 * paths live in this known space (not measured from the DOM), which is what makes
 * the camera (pan/zoom) and choreographed beams tractable. The stage scales as a
 * whole — the rendering box is forced to STAGE's aspect ratio so these
 * coordinates map 1:1 onto the SVG viewBox and the percentage-positioned nodes.
 */
export const STAGE = { w: 1000, h: 520 } as const;

export interface StageNode {
  /** Center, in stage coordinates. */
  x: number;
  y: number;
  /** Box half-extents, so beams can anchor at the node edge, not its center. */
  w: number;
  h: number;
}

// Three heroes on a horizontal spine (client · protocol · engine); the browser
// cluster (react, demo) stacks above the client.
export const POS: Record<string, StageNode> = {
  client: { x: 240, y: 330, w: 152, h: 62 },
  protocol: { x: 500, y: 330, w: 152, h: 62 },
  engine: { x: 772, y: 330, w: 152, h: 62 },
  react: { x: 240, y: 198, w: 128, h: 50 },
  demo: { x: 240, y: 86, w: 128, h: 50 },
};

export interface Band {
  zone: 'browser' | 'contract' | 'server';
  label: string;
  x: number;
  width: number;
}

// Light label bands behind the nodes — the deployment zones, without glass boxes.
export const BANDS: Band[] = [
  { zone: 'browser', label: 'Browser', x: 0, width: 384 },
  { zone: 'contract', label: 'Contract', x: 384, width: 232 },
  { zone: 'server', label: 'Server', x: 616, width: 384 },
];

export interface Framing {
  cx: number;
  cy: number;
  scale: number;
}

// Where the camera looks for each beat — the zoom/pan choreography. intent is a
// wide establishing shot (the resting view); the camera then pans/zooms to the
// part of the round-trip each beat is about.
export const FRAMING: Record<LoopStep, Framing> = {
  // Wide beats keep cy below the stage centre and scale <= 1 so the full stage —
  // including the band labels at the top — stays in frame, never cropped.
  intent: { cx: 500, cy: 248, scale: 0.99 },
  request: { cx: 560, cy: 330, scale: 1.12 },
  decide: { cx: 772, cy: 330, scale: 1.5 },
  respond: { cx: 500, cy: 330, scale: 1.12 },
  layout: { cx: 310, cy: 330, scale: 1.45 },
  actions: { cx: 310, cy: 330, scale: 1.45 },
  observe: { cx: 500, cy: 248, scale: 0.95 },
  loop: { cx: 500, cy: 248, scale: 0.98 },
};

/**
 * CSS transform (SVG user units) that brings a framing's focus point to the
 * stage center at its scale. Applied to the camera <g>; pair with
 * transform-origin: 0 0 and transition for smooth pan/zoom between beats.
 */
export function cameraTransform(f: Framing): string {
  const tx = STAGE.w / 2 - f.cx * f.scale;
  const ty = STAGE.h / 2 - f.cy * f.scale;
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${f.scale})`;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** foreignObject rect (top-left origin) for a node centered at its position. */
export function nodeRect(node: StageNode): Rect {
  return {
    x: node.x - node.w / 2,
    y: node.y - node.h / 2,
    width: node.w,
    height: node.h,
  };
}

/**
 * Point where a ray from the node center toward (tx, ty) exits the node's box,
 * so beams anchor at the visible edge instead of disappearing under the card.
 */
export function anchor(
  node: StageNode,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const dx = tx - node.x;
  const dy = ty - node.y;
  const sx = dx === 0 ? Infinity : node.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : node.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: node.x + dx * s, y: node.y + dy * s };
}
