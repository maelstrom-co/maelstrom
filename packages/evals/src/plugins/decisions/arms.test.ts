import { describe, expect, test } from 'bun:test';
import {
  DECISIONS_TEST_MODEL,
  dummyAdapter,
} from '@maelstrom-co/planner-jev/_testing';
import type { AnyTextAdapter } from '@tanstack/ai';
import { armRegistry, defaultArms, resolveArms } from '../../core/arms.js';
import type { ArmDeps } from '../../core/plugin.js';
import type { LlmRole } from '../../core/usage-adapter.js';
import type { JevArm } from '../jev/arms.js';
import { jevPlugin } from '../jev/plugin.js';
import { llmPlugin } from '../llm/plugin.js';
import { decisionsArms } from './arms.js';
import { decisionsClientBuilder } from './client-builder.js';
import { decisionsSettings } from './decisions-settings.js';
import { decisionsPlugin } from './plugin.js';

const plugins = [llmPlugin, jevPlugin, decisionsPlugin];

describe('the Decisions arms', () => {
  test('are the POC and the composed pairs planner, with the replay shapes of their Jev twins', () => {
    const arms = decisionsPlugin.arms as readonly JevArm[];
    expect(
      arms.map(({ name, kind, replayShape }) => ({ name, kind, replayShape })),
    ).toEqual([
      { name: 'decisions-poc', kind: 'decisions-poc', replayShape: 'poc' },
      {
        name: 'decisions-composed-pairs',
        kind: 'decisions',
        replayShape: 'gated',
      },
      {
        name: 'decisions-poc-prose',
        kind: 'decisions-poc',
        replayShape: 'poc',
      },
      {
        name: 'decisions-poc-screen-scope-prose',
        kind: 'decisions-poc',
        replayShape: 'poc',
      },
    ]);
    const twins = jevPlugin.arms as readonly JevArm[];
    const twinShape = (name: string) =>
      twins.find((arm) => arm.name === name)?.replayShape;
    expect(twinShape('jev-poc')).toBe(arms[0]?.replayShape);
    expect(
      twinShape('jev-gated-per-instance-composed-pairs-gate-and-defer-inline'),
    ).toBe(arms[1]?.replayShape);
  });

  test('need only the OpenAI key', () => {
    for (const arm of decisionsPlugin.arms)
      expect(arm.requiredEnv).toEqual(['OPENAI_API_KEY']);
  });

  test('resolve beside the baseline and the Jev arms for the full comparison', () => {
    expect(
      resolveArms(plugins, [
        'baseline',
        'jev-poc',
        'decisions-poc',
        'jev-gated-per-instance-composed-pairs-gate-and-defer-inline',
        'decisions-composed-pairs',
      ]).map(({ arm, plugin }) => `${plugin.name}:${arm.name}`),
    ).toEqual([
      'llm:baseline',
      'jev:jev-poc',
      'decisions:decisions-poc',
      'jev:jev-gated-per-instance-composed-pairs-gate-and-defer-inline',
      'decisions:decisions-composed-pairs',
    ]);
  });

  test('keep arm names unique across plugins and leave the default run unchanged', () => {
    const names = plugins.flatMap((plugin) =>
      plugin.arms.map((arm) => arm.name),
    );
    expect(new Set(names).size).toBe(names.length);
    expect(armRegistry(plugins).size).toBe(names.length);
    expect(defaultArms(plugins)).toEqual(['baseline', 'jev-poc']);
  });

  test('each arm builds a planner on the completion role of the given client', () => {
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
    const client = decisionsClientBuilder(
      decisionsSettings({
        apiKey: 'decisions-test-key',
        model: DECISIONS_TEST_MODEL,
      }),
    );
    const arms = decisionsArms(client, client);
    for (const arm of arms) expect(typeof arm.build(deps)).toBe('function');
    expect(roles).toEqual(arms.map((): LlmRole => 'complete'));
  });
});
