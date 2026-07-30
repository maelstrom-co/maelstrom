import type { InstanceId } from '@maelstrom-co/protocol';
import { TilingLayoutSchema } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { calendarVessel } from '../vessels/calendar.vessel';
import { tasksVessel } from '../vessels/tasks.vessel';
import { DEFAULT_LAYOUT } from './default-layout';

describe('DEFAULT_LAYOUT', () => {
  it('parses as a tiling layout', () => {
    // A malformed constant would surface as a blank first screen at runtime
    // with nothing in the console — parse it here instead. Note this checks
    // shape only: TilingLayoutSchema has no `type` field and strips it on
    // parse, so it can't confirm the 'tiling' discriminant — TypeScript
    // already enforces that via DEFAULT_LAYOUT's TilingLayout annotation.
    expect(() => TilingLayoutSchema.parse(DEFAULT_LAYOUT)).not.toThrow();
  });

  it('declares every instance its tree references', () => {
    const declared = DEFAULT_LAYOUT.instances.map(
      (instance) => instance.instanceId as string,
    );
    const leaves = DEFAULT_LAYOUT.tree.filter(
      (node): node is InstanceId =>
        node !== null && node !== 'H' && node !== 'V',
    );

    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(declared).toContain(leaf);
    }
  });

  it('names variants that exist on their vessels', () => {
    // Reads variants off the real vessel definitions rather than a
    // hand-copied list, so renaming or removing a variant there (e.g.
    // calendar's 'day') fails this test instead of only failing at runtime.
    const vesselsById = {
      calendar: calendarVessel,
      tasks: tasksVessel,
    } as const;

    for (const instance of DEFAULT_LAYOUT.instances) {
      const vessel = vesselsById[instance.vesselId as keyof typeof vesselsById];
      expect(vessel).toBeDefined();
      expect(Object.keys(vessel.variants)).toContain(instance.variant);
    }
  });
});
