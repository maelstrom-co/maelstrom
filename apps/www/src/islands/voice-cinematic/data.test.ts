import { describe, it, expect } from 'bun:test';
import {
  transcript,
  allPanels,
  panelMap,
  dashboardKeyframes,
  orbKeyframes,
} from './data';

describe('voice cinematic data', () => {
  it('transcript entries have ascending at values', () => {
    for (let i = 1; i < transcript.length; i++) {
      expect(transcript[i].at).toBeGreaterThan(transcript[i - 1].at);
    }
  });

  it('all panels have unique IDs', () => {
    const ids = allPanels.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('panelMap resolves each panel id back to its panel', () => {
    for (const panel of allPanels) {
      expect(panelMap.get(panel.id)).toBe(panel);
    }
  });

  it('dashboard keyframes reference only valid panel IDs', () => {
    for (const kf of dashboardKeyframes) {
      for (const slot of kf.layout) {
        expect(panelMap.has(slot.id)).toBe(true);
      }
    }
  });

  it('dashboard keyframes have ascending at values', () => {
    for (let i = 1; i < dashboardKeyframes.length; i++) {
      expect(dashboardKeyframes[i].at).toBeGreaterThan(
        dashboardKeyframes[i - 1].at,
      );
    }
  });

  it('orb keyframes have ascending at values', () => {
    for (let i = 1; i < orbKeyframes.length; i++) {
      expect(orbKeyframes[i].at).toBeGreaterThanOrEqual(orbKeyframes[i - 1].at);
    }
  });

  it('layout slot coordinates are normalized (0-1 range)', () => {
    for (const kf of dashboardKeyframes) {
      for (const slot of kf.layout) {
        expect(slot.x).toBeGreaterThanOrEqual(0);
        expect(slot.x).toBeLessThanOrEqual(1);
        expect(slot.y).toBeGreaterThanOrEqual(0);
        expect(slot.y).toBeLessThanOrEqual(1);
        expect(slot.w).toBeGreaterThan(0);
        expect(slot.w).toBeLessThanOrEqual(1);
        expect(slot.h).toBeGreaterThan(0);
        expect(slot.h).toBeLessThanOrEqual(1);
        expect(slot.x + slot.w).toBeLessThanOrEqual(1);
        expect(slot.y + slot.h).toBeLessThanOrEqual(1);
      }
    }
  });
});
