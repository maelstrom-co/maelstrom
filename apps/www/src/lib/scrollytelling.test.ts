import { describe, expect, it } from 'bun:test';
import { computeHeaderOpacity, findClosestStep } from './scrollytelling';

describe('computeHeaderOpacity', () => {
  it('returns 0 before section enters viewport', () => {
    expect(computeHeaderOpacity(-1.0)).toBe(0);
  });

  it('fades in as section approaches', () => {
    const opacity = computeHeaderOpacity(-0.5);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it('returns 1 when section is centered', () => {
    expect(computeHeaderOpacity(0)).toBe(1);
  });

  it('fades out as steps begin overlapping', () => {
    const opacity = computeHeaderOpacity(0.1);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it('returns 0 after full fade-out', () => {
    expect(computeHeaderOpacity(0.3)).toBe(0);
  });

  it('clamps to 0-1 range', () => {
    expect(computeHeaderOpacity(-2)).toBe(0);
    expect(computeHeaderOpacity(5)).toBe(0);
  });
});

describe('findClosestStep', () => {
  it('returns 0 when first step is closest', () => {
    const stepCenters = [100, 300, 500];
    expect(findClosestStep(stepCenters, 80)).toBe(0);
  });

  it('returns middle step when it is closest', () => {
    const stepCenters = [100, 300, 500];
    expect(findClosestStep(stepCenters, 290)).toBe(1);
  });

  it('returns last step when it is closest', () => {
    const stepCenters = [100, 300, 500];
    expect(findClosestStep(stepCenters, 480)).toBe(2);
  });

  it('breaks ties by returning first match', () => {
    const stepCenters = [100, 300];
    expect(findClosestStep(stepCenters, 200)).toBe(0);
  });

  it('returns -1 for empty array', () => {
    expect(findClosestStep([], 100)).toBe(-1);
  });
});
