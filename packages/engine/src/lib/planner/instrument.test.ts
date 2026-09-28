import { describe, expect, test } from 'bun:test';
import { ok } from '@maelstrom-co/protocol';

import {
  makePlanningInput,
  makeStageContext,
} from '../__test-helpers__/stage-context.js';
import { named, noopInstrument, stageName } from './instrument.js';
import type { PlanningInput, Stage } from './stage.js';

describe('named', () => {
  test('returns the same stage and records its name', () => {
    const stage: Stage<PlanningInput, number> = async () => ok(1);

    expect(named('select', stage)).toBe(stage);
    expect(stageName(stage)).toBe('select');
  });

  test('a stage named twice keeps the last name', () => {
    const stage: Stage<PlanningInput, number> = async () => ok(1);

    named('first', stage);
    named('second', stage);

    expect(stageName(stage)).toBe('second');
  });

  test('an unnamed stage has no name', () => {
    const stage: Stage<PlanningInput, number> = async () => ok(1);

    expect(stageName(stage)).toBeUndefined();
  });
});

describe('noopInstrument', () => {
  test('returns the stage unchanged', () => {
    const stage: Stage<PlanningInput, number> = async () => ok(1);

    expect(noopInstrument.stage('select', stage)).toBe(stage);
  });

  test('ignores events', () => {
    expect(() =>
      noopInstrument.event('llm.call', { 'maelstrom.latency_ms': 3 }),
    ).not.toThrow();
  });

  test('is the stage context default', async () => {
    const ctx = makeStageContext();

    expect(ctx.instrument).toBe(noopInstrument);
    const stage: Stage<PlanningInput, number> = async () => ok(1);
    expect(
      await ctx.instrument.stage('select', stage)(makePlanningInput(), ctx),
    ).toEqual(ok(1));
  });
});
