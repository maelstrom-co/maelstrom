import { describe, expect, it } from 'bun:test';
import { anchor, labelPoint, nodeRect } from '../geometry';
import { LIVEKIT_CASCADE_OWNERSHIP } from '../livekit-cascade';
import { OPENAI_REALTIME_OWNERSHIP } from '../openai-realtime';
import type { OwnershipNode } from '../types';

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

  it('arcs every lifted path clear of the cards it passes over', () => {
    // An arc is how the diagram claims a path bypasses a zone. One that clipped
    // a card in between would draw the opposite of the prose it illustrates.
    const arcs = model.edges.filter((edge) => edge.lift !== undefined);
    expect(arcs.length).toBeGreaterThan(0);

    for (const arc of arcs) {
      const from = byId.get(arc.from);
      const to = byId.get(arc.to);
      if (!from || !to) throw new Error(`${arc.id} is missing an endpoint`);

      const a = { x: from.x, y: from.y - from.h / 2 };
      const b = { x: to.x, y: to.y - to.h / 2 };
      const control = { x: (a.x + b.x) / 2, y: arc.lift ?? 0 };
      const pointAt = (t: number) => ({
        x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * control.x + t ** 2 * b.x,
        y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * control.y + t ** 2 * b.y,
      });

      const crossed = model.nodes.filter(
        (n) => n.id !== from.id && n.id !== to.id,
      );
      for (let step = 0; step <= 100; step += 1) {
        const p = pointAt(step / 100);
        // The apex must also stay on the stage: the arc is drawn above every
        // card, and an over-lifted one silently leaves the viewBox.
        expect(p.y).toBeGreaterThanOrEqual(0);
        for (const n of crossed) {
          const insideX = Math.abs(p.x - n.x) <= n.w / 2;
          const insideY = Math.abs(p.y - n.y) <= n.h / 2;
          expect(insideX && insideY).toBe(false);
        }
      }
    }
  });
});
