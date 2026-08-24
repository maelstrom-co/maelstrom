import { describe, expect, it } from 'vitest';
import {
  REQUIRED_WORKER_BINDINGS,
  type RequiredWorkerBinding,
} from '../worker-bindings';
import type { PlaygroundEnv } from './session-do';

type MissingAlchemyBinding = Exclude<
  RequiredWorkerBinding,
  keyof PlaygroundEnv
>;

describe('Worker deployment bindings', () => {
  it('keeps Alchemy responsible for every explicit runtime binding', () => {
    const alchemyHasEveryBinding: MissingAlchemyBinding extends never
      ? true
      : false = true;

    expect(alchemyHasEveryBinding).toBe(true);
    expect(REQUIRED_WORKER_BINDINGS).toEqual(['SESSION_DO', 'WS_RATE_LIMITER']);
  });
});
