import { beforeEach, describe, expect, it } from 'bun:test';

import type { ChartDimensions } from '@maelstrom-co/protocol';

import type { ChartManagerEvents } from './chart-manager.js';
import { ChartManager } from './chart-manager.js';
import { createInitialChartManagerState } from './chart-manager.state.js';

type DimensionsChangedEvent = ChartManagerEvents['dimensions_changed'];

describe('ChartManager', () => {
  let manager: ChartManager;

  beforeEach(() => {
    manager = new ChartManager();
  });

  describe('initialization', () => {
    it('should not mutate state on initialization', () => {
      expect(manager.store.state).toEqual(createInitialChartManagerState());
    });

    it('should have default chart dimensions', () => {
      expect(manager.getDimensions()).toEqual({ columns: 12, rows: 8 });
    });

    it('should have no pending resize', () => {
      expect(manager.getPendingResize()).toBeNull();
    });

    it('should accept custom initial state', () => {
      const custom = new ChartManager({
        initialState: { chartDimensions: { columns: 3, rows: 2 } },
      });
      expect(custom.getDimensions()).toEqual({ columns: 3, rows: 2 });
    });
  });

  describe('setDimensions', () => {
    it('should update chart dimensions in the store', () => {
      const newDimensions: ChartDimensions = { columns: 6, rows: 4 };

      manager.setDimensions(newDimensions);

      expect(manager.store.state.chartDimensions).toEqual(newDimensions);
    });

    it('should return the updated dimensions via getDimensions', () => {
      const newDimensions: ChartDimensions = { columns: 6, rows: 4 };

      manager.setDimensions(newDimensions);

      expect(manager.getDimensions()).toEqual(newDimensions);
    });

    it('should emit dimensions_changed event', () => {
      const events: DimensionsChangedEvent[] = [];
      manager.events.on('dimensions_changed', (event) => {
        events.push(event);
      });

      const newDimensions: ChartDimensions = { columns: 6, rows: 4 };
      manager.setDimensions(newDimensions);

      expect(events).toHaveLength(1);
      expect(events[0].current).toEqual(newDimensions);
      expect(events[0].previous).toEqual({ columns: 12, rows: 8 });
    });

    it('should not emit event if dimensions are unchanged', () => {
      const events: DimensionsChangedEvent[] = [];
      manager.events.on('dimensions_changed', (event) => {
        events.push(event);
      });

      manager.setDimensions({ columns: 12, rows: 8 });

      expect(events).toHaveLength(0);
    });

    it('should track previous dimensions across multiple changes', () => {
      const events: DimensionsChangedEvent[] = [];
      manager.events.on('dimensions_changed', (event) => {
        events.push(event);
      });

      manager.setDimensions({ columns: 6, rows: 4 });
      manager.setDimensions({ columns: 3, rows: 2 });

      expect(events).toHaveLength(2);
      expect(events[1].previous).toEqual({ columns: 6, rows: 4 });
      expect(events[1].current).toEqual({ columns: 3, rows: 2 });
    });

    it('should throw after dispose', () => {
      manager.dispose();

      expect(() => manager.setDimensions({ columns: 6, rows: 4 })).toThrow(
        'ChartManager is disposed',
      );
    });
  });

  describe('pending resize', () => {
    it('should create a pending resize update reason from dimension change', () => {
      const previous: ChartDimensions = { columns: 12, rows: 8 };
      const current: ChartDimensions = { columns: 6, rows: 4 };

      manager.setDimensions(current);

      const pending = manager.getPendingResize();
      expect(pending).toEqual({
        type: 'chart_resize',
        previous,
        current,
      });
    });

    it('should return the latest pending resize when dimensions change multiple times', () => {
      manager.setDimensions({ columns: 6, rows: 4 });
      manager.setDimensions({ columns: 3, rows: 2 });

      const pending = manager.getPendingResize();
      expect(pending).not.toBeNull();
      if (!pending) throw new Error('expected pending resize');
      expect(pending.type).toBe('chart_resize');
      if (pending.type === 'chart_resize') {
        expect(pending.current).toEqual({ columns: 3, rows: 2 });
      }
    });

    it('should clear pending resize when clearPendingResize is called', () => {
      manager.setDimensions({ columns: 6, rows: 4 });

      expect(manager.getPendingResize()).not.toBeNull();

      manager.clearPendingResize();

      expect(manager.getPendingResize()).toBeNull();
    });

    it('should have no pending resize if dimensions have not changed', () => {
      expect(manager.getPendingResize()).toBeNull();
    });
  });

  describe('dispose', () => {
    it('should be idempotent', () => {
      manager.dispose();
      manager.dispose(); // should not throw
    });
  });
});
