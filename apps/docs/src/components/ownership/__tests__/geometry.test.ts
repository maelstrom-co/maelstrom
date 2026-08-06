import { describe, expect, it } from 'bun:test';
import {
  anchor,
  arcAnchor,
  arcControl,
  edgeAnchors,
  labelPoint,
  nodeRect,
} from '../geometry';
import { LIVEKIT_CASCADE_OWNERSHIP } from '../livekit-cascade';
import { LIVEKIT_TURN_OWNERSHIP } from '../livekit-turn-ownership';
import { OPENAI_REALTIME_OWNERSHIP } from '../openai-realtime';
import type { OwnershipNode } from '../types';
import { VOICE_BOUNDARY } from '../voice-boundary';

const node: OwnershipNode = {
  id: 'n',
  label: 'n',
  tone: 'yours',
  x: 100,
  y: 100,
  w: 200,
  h: 100,
};

describe('anchor', () => {
  it('lands on the box edge so a path starts where the card visibly ends', () => {
    const point = anchor(node, 400, 100);
    expect(point).toEqual({ x: 200, y: 100 });
  });

  it('returns a finite point for a target at the node center', () => {
    // A zero-length ray would otherwise scale 0 by Infinity and emit
    // "M NaN,NaN", which browsers drop silently — the edge just disappears.
    const point = anchor(node, node.x, node.y);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('arcAnchor', () => {
  it('leaves the side the arc bends toward', () => {
    // Leaving the top for an arc that dips below would cross the node's own
    // card on the way down — the one place a path is guaranteed to look wrong.
    expect(arcAnchor(node, -40)).toEqual({ x: 100, y: 50 });
    expect(arcAnchor(node, 400)).toEqual({ x: 100, y: 150 });
  });
});

describe('edgeAnchors', () => {
  it('rejects an arc too shallow to clear the card it leaves', () => {
    // Guards the guard. The clearance sweep below only earns its keep if it
    // fails on an arc that turns back under its own endpoint card, and no
    // shipped model contains one, so reproduce the case directly.
    const other: OwnershipNode = { ...node, id: 'o', x: 500 };
    // Inside the card's own vertical span: neither edge is a safe exit.
    const arc = node.y + node.h / 4;
    const [a, b] = edgeAnchors(node, other, arc);
    const control = arcControl(a, b, arc);

    const entered = Array.from({ length: 101 }, (_, step) => step / 100).some(
      (t) => {
        const x =
          (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x;
        const y =
          (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y;
        return (
          Math.abs(x - node.x) < node.w / 2 && Math.abs(y - node.y) < node.h / 2
        );
      },
    );

    expect(entered).toBe(true);
  });
});

describe('nodeRect', () => {
  it('converts a center to the top-left origin foreignObject uses', () => {
    expect(nodeRect(node)).toEqual({ x: 0, y: 50, width: 200, height: 100 });
  });
});

describe('labelPoint', () => {
  it('puts an arc label at the apex, not at the control point', () => {
    // The apex of a quadratic sits halfway between chord and control. Treating
    // the control point as the apex would float every arc label into open space.
    const at = labelPoint({ x: 0, y: 100 }, { x: 200, y: 100 }, 0);
    expect(at).toEqual({ x: 100, y: 50 });
  });
});

const MODELS = [
  ['OpenAI Realtime', OPENAI_REALTIME_OWNERSHIP],
  ['LiveKit cascade', LIVEKIT_CASCADE_OWNERSHIP],
  ['LiveKit turn ownership', LIVEKIT_TURN_OWNERSHIP],
  ['voice boundary', VOICE_BOUNDARY],
] as const;

describe.each(MODELS)('the %s ownership model', (_name, model) => {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));

  it('places every node inside exactly one band', () => {
    for (const n of model.nodes) {
      const bands = model.bands.filter(
        (band) =>
          n.x - n.w / 2 >= band.x && n.x + n.w / 2 <= band.x + band.width,
      );
      expect(bands).toHaveLength(1);
    }
  });

  it('connects every edge to nodes that exist', () => {
    for (const edge of model.edges) {
      expect(byId.has(edge.from)).toBe(true);
      expect(byId.has(edge.to)).toBe(true);
    }
  });

  it('keeps every card on the stage', () => {
    for (const n of model.nodes) {
      expect(n.x - n.w / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w / 2).toBeLessThanOrEqual(model.stage.w);
      expect(n.y - n.h / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h / 2).toBeLessThanOrEqual(model.stage.h);
    }
  });

  it('routes every path clear of every card, including its own', () => {
    // A path that disappears under a card it has nothing to do with reads as a
    // connection to that card. The arcs exist precisely to claim a path bypasses
    // a zone, so one clipping a card would draw the opposite of the prose.
    //
    // Endpoint cards are checked too, on the card's strict interior so the
    // anchors themselves stay legal. An arc whose height falls inside its own
    // endpoint card turns back under it, and excluding endpoints was what let
    // that go unseen.
    for (const edge of model.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) throw new Error(`${edge.id} is missing an endpoint`);

      // Built from the same helpers the diagram renders with. Recomputing them
      // here would leave the real ones unguarded.
      const arcY = edge.arc;
      const [a, b] = edgeAnchors(from, to, arcY);
      const control = arcY === undefined ? a : arcControl(a, b, arcY);
      const pointAt = (t: number) =>
        arcY !== undefined
          ? {
              x:
                (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x,
              y:
                (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y,
            }
          : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };

      for (let step = 0; step <= 100; step += 1) {
        const p = pointAt(step / 100);
        // An over-bent arc silently leaves the viewBox instead of failing, and
        // it can now leave through either end of the stage.
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(model.stage.h);
        for (const n of model.nodes) {
          const insideX = Math.abs(p.x - n.x) < n.w / 2;
          const insideY = Math.abs(p.y - n.y) < n.h / 2;
          expect(insideX && insideY).toBe(false);
        }
      }
    }
  });
});
