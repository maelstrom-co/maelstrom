import { describe, expect, test } from 'bun:test';

import type { AnyTextAdapter } from '@tanstack/ai';

import { dummyAdapter } from '../src/lib/__test-helpers__/mock-chat.js';
import { TEST_MODEL } from '../src/lib/__test-helpers__/scripted-fetch.js';
import { type ArmDeps, arms, DEFAULT_ARMS, resolveArms } from './arms.js';
import type { LlmRole } from './usage-adapter.js';

describe('arm registry', () => {
  test('holds the baseline and the frozen POC by name', () => {
    expect(arms.baseline).toMatchObject({ name: 'baseline', kind: 'baseline' });
    expect(arms['jev-poc']).toMatchObject({ name: 'jev-poc', kind: 'jev-poc' });
    expect(DEFAULT_ARMS).toEqual(['baseline', 'jev-poc']);
  });

  test('resolves exact names in the order given', () => {
    expect(resolveArms(['jev-poc', 'baseline']).map((arm) => arm.name)).toEqual(
      ['jev-poc', 'baseline'],
    );
  });

  test('keeps jev as an alias of jev-poc', () => {
    expect(resolveArms(['jev'])).toEqual([arms['jev-poc']]);
  });

  test('drops repeated names, keeping the first position', () => {
    expect(
      resolveArms(['jev-poc', 'baseline', 'jev-poc', 'jev']).map(
        (arm) => arm.name,
      ),
    ).toEqual(['jev-poc', 'baseline']);
  });

  test('rejects an unknown name, listing the known ones', () => {
    expect(() => resolveArms(['baseline', 'jev2'])).toThrow(
      'unknown arm jev2; known arms: baseline, jev-poc (alias jev)',
    );
    expect(() => resolveArms([])).toThrow('at least one arm');
  });

  test('each arm builds a planner from the adapter roles it uses', () => {
    const roles: LlmRole[] = [];
    const deps: ArmDeps = {
      typesafe: { apiKey: 'typesafe-test-key', model: TEST_MODEL },
      adapter: (role): AnyTextAdapter => {
        roles.push(role);
        return dummyAdapter;
      },
      fallback: async () => {
        throw new Error('not called');
      },
      instrument: (_name, stage) => stage,
    };
    expect(typeof arms.baseline?.build(deps)).toBe('function');
    expect(typeof arms['jev-poc']?.build(deps)).toBe('function');
    expect(roles).toEqual(['planner', 'complete']);
  });
});
