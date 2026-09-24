import { describe, expect, test } from 'bun:test';
import { dummyAdapter, TEST_MODEL } from '@maelstrom-co/planner-jev/_testing';
import type { AnyTextAdapter } from '@tanstack/ai';
import {
  type Arm,
  type ArmDeps,
  armRegistry,
  arms,
  DEFAULT_ARMS,
  resolveArms,
} from './arms.js';
import type { LlmRole } from './usage-adapter.js';

describe('arm registry', () => {
  test('holds the baseline and the frozen POC by name', () => {
    expect(arms.baseline).toMatchObject({ name: 'baseline', kind: 'baseline' });
    expect(arms['jev-poc']).toMatchObject({ name: 'jev-poc', kind: 'jev-poc' });
    expect(arms['jev-ungated-stepwise-preset-inline']).toMatchObject({
      name: 'jev-ungated-stepwise-preset-inline',
      kind: 'jev',
    });
    expect(DEFAULT_ARMS).toEqual(['baseline', 'jev-poc']);
  });

  test('holds every actions, layout and complete stage variant, each under its own name', () => {
    expect(Object.keys(arms)).toEqual([
      'baseline',
      'jev-poc',
      'jev-ungated-stepwise-preset-inline',
      'jev-ungated-batched-preset-inline',
      'jev-ungated-per-instance-preset-inline',
      'jev-gated-stepwise-preset-inline',
      'jev-gated-batched-preset-inline',
      'jev-gated-per-instance-preset-inline',
      'jev-gated-per-instance-preset-or-llm-inline',
      'jev-gated-per-instance-preset-or-llm-parallel',
      'jev-gated-per-instance-composed-pairs-gate-and-defer-inline',
      'jev-ungated-per-instance-preset-or-llm-inline',
    ]);
    for (const [name, arm] of Object.entries(arms)) expect(arm.name).toBe(name);
    expect(
      Object.fromEntries(
        Object.values(arms).map((arm) => [arm.name, arm.replayShape ?? 'poc']),
      ),
    ).toEqual({
      baseline: 'poc',
      'jev-poc': 'poc',
      'jev-ungated-stepwise-preset-inline': 'ungated',
      'jev-ungated-batched-preset-inline': 'ungated',
      'jev-ungated-per-instance-preset-inline': 'ungated',
      'jev-gated-stepwise-preset-inline': 'gated',
      'jev-gated-batched-preset-inline': 'gated',
      'jev-gated-per-instance-preset-inline': 'gated',
      'jev-gated-per-instance-preset-or-llm-inline': 'gated',
      'jev-gated-per-instance-preset-or-llm-parallel': 'gated',
      'jev-gated-per-instance-composed-pairs-gate-and-defer-inline': 'gated',
      'jev-ungated-per-instance-preset-or-llm-inline': 'ungated',
    });
  });

  test('refuses two arms with one name', () => {
    const arm = arms.baseline as Arm;
    expect(() => armRegistry([arm, { ...arm }])).toThrow(
      'arm baseline is registered twice',
    );
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
      'unknown arm jev2; known arms: baseline, jev-poc (alias jev), jev-ungated-stepwise-preset-inline, jev-ungated-batched-preset-inline, jev-ungated-per-instance-preset-inline, jev-gated-stepwise-preset-inline, jev-gated-batched-preset-inline, jev-gated-per-instance-preset-inline, jev-gated-per-instance-preset-or-llm-inline, jev-gated-per-instance-preset-or-llm-parallel, jev-gated-per-instance-composed-pairs-gate-and-defer-inline, jev-ungated-per-instance-preset-or-llm-inline',
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
    for (const arm of Object.values(arms))
      expect(typeof arm.build(deps)).toBe('function');
    expect(roles).toEqual([
      'planner',
      ...Object.keys(arms)
        .slice(1)
        .map((): LlmRole => 'complete'),
    ]);
  });
});
