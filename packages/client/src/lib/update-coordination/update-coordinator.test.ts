import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import type { UpdateReason } from '@maelstrom-co/protocol-old';

import type { UpdateCoordinatorEvents } from './update-coordinator.js';
import { UpdateCoordinator } from './update-coordinator.js';

type UpdatesFlushedEvent = UpdateCoordinatorEvents['updates_flushed'];

function makeChartResize(columns = 12, rows = 8): UpdateReason {
  return {
    type: 'chart_resize',
    previous: { columns: 0, rows: 0 },
    current: { columns, rows },
  };
}

function makeVesselMutation(instanceId: string, changes: string): UpdateReason {
  return { type: 'vessel_mutation', instanceId, changes };
}

describe('UpdateCoordinator', () => {
  let coordinator: UpdateCoordinator;
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
    coordinator = new UpdateCoordinator();
  });

  afterEach(() => {
    clock.uninstall();
  });

  describe('initialization', () => {
    it('should start with no pending updates', () => {
      expect(coordinator.hasPending()).toBe(false);
      expect(coordinator.pendingCount).toBe(0);
      expect(coordinator.getPending()).toEqual([]);
    });
  });

  describe('schedule', () => {
    it('should add an update to the pending queue', () => {
      const reason = makeChartResize();
      coordinator.schedule(reason);

      expect(coordinator.hasPending()).toBe(true);
      expect(coordinator.pendingCount).toBe(1);
      expect(coordinator.getPending()).toEqual([reason]);
    });

    it('should not flush immediately (all reasons are debounced)', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize());

      expect(flushed).toHaveLength(0);
      expect(coordinator.hasPending()).toBe(true);
    });

    it('should be a no-op after dispose', () => {
      coordinator.dispose();
      coordinator.schedule(makeChartResize());

      expect(coordinator.hasPending()).toBe(false);
      expect(coordinator.pendingCount).toBe(0);
    });
  });

  describe('flush', () => {
    it('should return empty array when nothing pending', () => {
      const result = coordinator.flush();
      expect(result).toEqual([]);
    });

    it('should return coalesced updates and clear queue', () => {
      coordinator.schedule(makeChartResize(4, 4));
      const result = coordinator.flush();

      expect(result).toHaveLength(1);
      expect(coordinator.hasPending()).toBe(false);
      expect(coordinator.pendingCount).toBe(0);
    });

    it('should emit updates_flushed event', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize());
      coordinator.flush();

      expect(flushed).toHaveLength(1);
      expect(flushed[0].rawCount).toBe(1);
      expect(flushed[0].updates).toHaveLength(1);
      expect(flushed[0].timestamp).toBeGreaterThanOrEqual(0);
    });

    it('should not emit when nothing to flush', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.flush();

      expect(flushed).toHaveLength(0);
    });
  });

  describe('coalescing', () => {
    it('should keep only the latest chart_resize', () => {
      coordinator.schedule(makeChartResize(4, 4));
      coordinator.schedule(makeChartResize(8, 8));
      coordinator.schedule(makeChartResize(12, 12));

      const result = coordinator.flush();

      const resizes = result.filter((u) => u.type === 'chart_resize');
      expect(resizes).toHaveLength(1);
      if (resizes[0].type === 'chart_resize') {
        expect(resizes[0].current.columns).toBe(12);
      }
    });

    it('should combine vessel_mutation for the same instance', () => {
      coordinator.schedule(makeVesselMutation('v1', 'color'));
      coordinator.schedule(makeVesselMutation('v1', 'size'));

      const result = coordinator.flush();

      const mutations = result.filter((u) => u.type === 'vessel_mutation');
      expect(mutations).toHaveLength(1);
      if (mutations[0].type === 'vessel_mutation') {
        expect(mutations[0].changes).toBe('color, size');
      }
    });

    it('should keep separate vessel_mutation for different instances', () => {
      coordinator.schedule(makeVesselMutation('v1', 'color'));
      coordinator.schedule(makeVesselMutation('v2', 'size'));

      const result = coordinator.flush();

      const mutations = result.filter((u) => u.type === 'vessel_mutation');
      expect(mutations).toHaveLength(2);
    });

    it('should preserve user_intent in order', () => {
      coordinator.schedule(makeChartResize());
      coordinator.schedule(makeVesselMutation('v1', 'x'));

      const result = coordinator.flush();

      expect(result).toHaveLength(2);
    });

    it('should handle mixed update types', () => {
      coordinator.schedule(makeChartResize(4, 4));
      coordinator.schedule(makeVesselMutation('v1', 'color'));
      coordinator.schedule(makeChartResize(8, 8));
      coordinator.schedule(makeVesselMutation('v1', 'size'));
      coordinator.schedule(makeVesselMutation('v2', 'pos'));

      const result = coordinator.flush();

      // 1 chart_resize (latest) + 2 vessel_mutations (v1 combined, v2 separate)
      expect(result).toHaveLength(3);
    });
  });

  describe('debounce and maxWait', () => {
    it('should flush after debounce delay', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize());
      expect(flushed).toHaveLength(0);

      clock.tick(300);
      expect(flushed).toHaveLength(1);
    });

    it('should reset debounce timer on new schedule', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize(4, 4));
      clock.tick(200);

      coordinator.schedule(makeChartResize(8, 8));
      clock.tick(200);

      // Should not have flushed yet (debounce reset)
      expect(flushed).toHaveLength(0);

      clock.tick(100); // 300ms since last schedule
      expect(flushed).toHaveLength(1);
    });

    it('should force flush after maxWait even with repeated schedules', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize(4, 4));

      clock.tick(250);
      coordinator.schedule(makeChartResize(8, 8));
      clock.tick(250);
      coordinator.schedule(makeChartResize(12, 12));
      clock.tick(250);
      coordinator.schedule(makeChartResize(16, 16));

      // 750ms elapsed — maxWait not yet hit
      expect(flushed).toHaveLength(0);

      clock.tick(250); // 1000ms total
      expect(flushed).toHaveLength(1);
    });

    it('should respect custom debounce and maxWait', () => {
      const customCoordinator = new UpdateCoordinator({
        debounceDelayMs: 100,
        maxWaitMs: 500,
      });

      const flushed: UpdatesFlushedEvent[] = [];
      customCoordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      customCoordinator.schedule(makeChartResize());
      clock.tick(100);

      expect(flushed).toHaveLength(1);
    });
  });

  describe('takeCoalesced', () => {
    it('should return empty array when nothing pending', () => {
      expect(coordinator.takeCoalesced()).toEqual([]);
    });

    it('should return coalesced updates and clear queue', () => {
      coordinator.schedule(makeChartResize(4, 4));
      coordinator.schedule(makeChartResize(8, 8));

      const result = coordinator.takeCoalesced();

      expect(result).toHaveLength(1);
      expect(coordinator.hasPending()).toBe(false);
    });

    it('should NOT emit updates_flushed event', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize());
      coordinator.takeCoalesced();

      expect(flushed).toHaveLength(0);
    });

    it('should clear timers', () => {
      coordinator.schedule(makeChartResize());
      coordinator.takeCoalesced();

      clock.tick(2000);
      expect(coordinator.hasPending()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all pending updates', () => {
      coordinator.schedule(makeChartResize());
      coordinator.schedule(makeVesselMutation('v1', 'x'));

      coordinator.clear();

      expect(coordinator.hasPending()).toBe(false);
      expect(coordinator.pendingCount).toBe(0);
    });

    it('should cancel pending timers', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.schedule(makeChartResize());
      coordinator.clear();

      clock.tick(2000);
      expect(flushed).toHaveLength(0);
    });
  });

  describe('dispose', () => {
    it('should clear pending updates', () => {
      coordinator.schedule(makeChartResize());
      coordinator.dispose();

      expect(coordinator.hasPending()).toBe(false);
    });

    it('should not fire events after dispose', () => {
      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.dispose();
      coordinator.schedule(makeChartResize());

      expect(flushed).toHaveLength(0);
    });

    it('should be idempotent', () => {
      expect(() => {
        coordinator.dispose();
        coordinator.dispose();
      }).not.toThrow();
    });

    it('should cancel pending timers', () => {
      coordinator.schedule(makeChartResize());

      const flushed: UpdatesFlushedEvent[] = [];
      coordinator.events.on('updates_flushed', (e) => {
        flushed.push(e);
      });

      coordinator.dispose();
      clock.tick(2000);

      expect(flushed).toHaveLength(0);
    });
  });

  describe('debug mode', () => {
    it('should not throw when debug is enabled', () => {
      const debugCoordinator = new UpdateCoordinator({ debug: true });

      expect(() => debugCoordinator.schedule(makeChartResize())).not.toThrow();
    });
  });
});
