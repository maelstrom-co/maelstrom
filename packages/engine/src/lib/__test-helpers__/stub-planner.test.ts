import { describe, expect, test } from 'bun:test';

import { isErr, isOk } from '@maelstrom-co/protocol';

import { providerError } from '../errors.js';
import type { PlannerCandidate } from '../planner/candidate.js';
import { defer } from './defer.js';
import { buildGridResponse } from './fixtures.js';
import { makePlanningInput, makeStageContext } from './stage-context.js';
import {
  blockingPlanner,
  failingPlanner,
  scriptedPlanner,
  throwingPlanner,
} from './stub-planner.js';

const input = makePlanningInput();
const ctx = makeStageContext({ origin: input });

describe('scriptedPlanner', () => {
  test('returns each candidate in order, one per call', async () => {
    const first: PlannerCandidate = buildGridResponse({
      userMessage: 'first',
    });
    const second: PlannerCandidate = buildGridResponse({
      userMessage: 'second',
    });
    const planner = scriptedPlanner([first, second]);

    const a = await planner(input, ctx);
    const b = await planner(input, ctx);

    expect(isOk(a) && a.value).toBe(first);
    expect(isOk(b) && b.value).toBe(second);
  });

  test('throws a clear error once every scripted candidate is consumed', async () => {
    const only: PlannerCandidate = buildGridResponse();
    const planner = scriptedPlanner([only]);

    await planner(input, ctx);

    await expect(planner(input, ctx)).rejects.toThrow(/exhausted/);
  });

  test('an empty script throws on the first call', async () => {
    const planner = scriptedPlanner([]);

    await expect(planner(input, ctx)).rejects.toThrow(/exhausted/);
  });
});

describe('blockingPlanner', () => {
  test('parks until the gate resolves, then resolves Ok with the gated candidate', async () => {
    const candidate: PlannerCandidate = buildGridResponse({
      userMessage: 'released',
    });
    const gate = defer<PlannerCandidate>();
    const { planner, entered } = blockingPlanner(gate);

    const resultPromise = planner(input, ctx);
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });

    await entered;
    // Still parked: resolving `entered` only proves the planner started, not
    // that the gate has released it.
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve(candidate);
    const result = await resultPromise;

    expect(isOk(result) && result.value).toBe(candidate);
  });

  test('rejects once the context signal aborts while parked', async () => {
    const gate = defer<PlannerCandidate>();
    const { planner, entered } = blockingPlanner(gate);
    const controller = new AbortController();
    const abortingCtx = makeStageContext({
      origin: input,
      signal: controller.signal,
    });

    const resultPromise = planner(input, abortingCtx);
    await entered;
    controller.abort('caller gave up');

    await expect(resultPromise).rejects.toThrow();
  });

  test('rejects immediately when the context signal is already aborted', async () => {
    const gate = defer<PlannerCandidate>();
    const { planner } = blockingPlanner(gate);
    const controller = new AbortController();
    controller.abort('gone before it started');
    const abortedCtx = makeStageContext({
      origin: input,
      signal: controller.signal,
    });

    await expect(planner(input, abortedCtx)).rejects.toThrow();
  });
});

describe('failingPlanner', () => {
  test('resolves Err with the given EngineError, every call', async () => {
    const failure = providerError('upstream down', new Error('503'));
    const planner = failingPlanner(failure);

    const a = await planner(input, ctx);
    const b = await planner(input, ctx);

    expect(isErr(a) && a.error).toBe(failure);
    expect(isErr(b) && b.error).toBe(failure);
  });
});

describe('throwingPlanner', () => {
  test('throws the given value, every call', async () => {
    const cause = new Error('stage bug');
    const planner = throwingPlanner(cause);

    await expect(planner(input, ctx)).rejects.toBe(cause);
    await expect(planner(input, ctx)).rejects.toBe(cause);
  });
});
