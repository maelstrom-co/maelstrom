import { describe, expect, test } from 'bun:test';
import {
  conversation,
  dummyAdapter,
  makeContext,
  makeInput,
  makeRequest,
  scriptedFetch,
  TEST_MODEL,
} from '@maelstrom-co/planner-jev/_testing';
import type { AnyTextAdapter } from '@tanstack/ai';
import { defaultArms, resolveArms } from '../../core/arms.js';
import type { ArmDeps } from '../../core/plugin.js';
import type { LlmRole } from '../../core/usage-adapter.js';
import { llmPlugin } from '../llm/plugin.js';
import { type JevArm, jevArms } from './arms.js';
import { jevPlugin, jevPluginWith } from './plugin.js';
import { typesafeSettings } from './typesafe-settings.js';

const plugins = [llmPlugin, jevPlugin];

describe('the Jev arms', () => {
  test('register the frozen POC and every stage-library planner beside the baseline', () => {
    expect(
      resolveArms(plugins, ['baseline', 'jev-poc']).map(({ arm }) => arm),
    ).toMatchObject([
      { name: 'baseline', baseline: true },
      { name: 'jev-poc', kind: 'jev-poc' },
    ]);
    expect(defaultArms(plugins)).toEqual(['baseline', 'jev-poc']);
    expect(jevPlugin.arms.map((arm) => arm.name)).toEqual([
      'jev-poc',
      'jev-poc-screen-scope',
      'jev-composed-pairs-screen-scope',
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
    expect(
      Object.fromEntries(
        (jevPlugin.arms as readonly JevArm[]).map((arm) => [
          arm.name,
          arm.replayShape,
        ]),
      ),
    ).toEqual({
      'jev-poc': 'poc',
      'jev-poc-screen-scope': 'poc',
      'jev-composed-pairs-screen-scope': 'gated',
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
    for (const arm of jevPlugin.arms.slice(1)) expect(arm.kind).toBe('jev');
  });

  test('keeps jev as an alias of jev-poc and lists the known arms on an unknown name', () => {
    expect(resolveArms(plugins, ['jev']).map(({ arm }) => arm.name)).toEqual([
      'jev-poc',
    ]);
    expect(() => resolveArms(plugins, ['baseline', 'jev2'])).toThrow(
      'unknown arm jev2; known arms: baseline, jev-poc (alias jev), jev-poc-screen-scope, jev-composed-pairs-screen-scope, jev-ungated-stepwise-preset-inline, jev-ungated-batched-preset-inline, jev-ungated-per-instance-preset-inline, jev-gated-stepwise-preset-inline, jev-gated-batched-preset-inline, jev-gated-per-instance-preset-inline, jev-gated-per-instance-preset-or-llm-inline, jev-gated-per-instance-preset-or-llm-parallel, jev-gated-per-instance-composed-pairs-gate-and-defer-inline, jev-ungated-per-instance-preset-or-llm-inline',
    );
  });

  test('every arm needs the OpenAI and TypeSafe keys', () => {
    for (const arm of jevPlugin.arms)
      expect(arm.requiredEnv).toEqual([
        'OPENAI_API_KEY',
        'TYPESAFE_API_KEY',
        'JEV_MODEL',
      ]);
  });

  test('each arm builds a planner from the adapter roles it uses, on the settings it was given', () => {
    const roles: LlmRole[] = [];
    const deps: ArmDeps = {
      adapter: (role): AnyTextAdapter => {
        roles.push(role);
        return dummyAdapter;
      },
      fallback: async () => {
        throw new Error('not called');
      },
      onCall: () => {},
    };
    const arms = jevArms(
      typesafeSettings({ apiKey: 'typesafe-test-key', model: TEST_MODEL }),
    );
    for (const arm of arms) expect(typeof arm.build(deps)).toBe('function');
    expect(roles).toEqual(arms.map((): LlmRole => 'complete'));
    expect(
      jevPluginWith({ typesafe: { model: 'jev-pinned' } }).meta?.(),
    ).toEqual({
      jevModel: 'jev-pinned',
    });
  });

  test('the shipped planner arms ask the screen scope select and the arms first measured keep their own', async () => {
    const asksScreen = async (name: string) => {
      const { fetch, calls } = scriptedFetch(conversation({}));
      const arm = jevArms(
        typesafeSettings({
          apiKey: 'typesafe-test-key',
          model: TEST_MODEL,
          fetch,
        }),
      ).find((candidate) => candidate.name === name);
      const planner = arm?.build({
        adapter: () => dummyAdapter,
        fallback: async () => {
          throw new Error('not called');
        },
        onCall: () => {},
      });
      const input = makeInput(makeRequest('hide the tasks'));
      await planner?.(input, makeContext(input)).catch(() => undefined);
      const [select] = calls;
      if (select === undefined) throw new Error(`${name} asked nothing`);
      return Object.keys(select.questions).includes('screen');
    };
    expect({
      'jev-poc': await asksScreen('jev-poc'),
      'jev-poc-screen-scope': await asksScreen('jev-poc-screen-scope'),
      'jev-gated-per-instance-composed-pairs-gate-and-defer-inline':
        await asksScreen(
          'jev-gated-per-instance-composed-pairs-gate-and-defer-inline',
        ),
      'jev-composed-pairs-screen-scope': await asksScreen(
        'jev-composed-pairs-screen-scope',
      ),
    }).toEqual({
      'jev-poc': false,
      'jev-poc-screen-scope': true,
      'jev-gated-per-instance-composed-pairs-gate-and-defer-inline': false,
      'jev-composed-pairs-screen-scope': true,
    });
  });
});
