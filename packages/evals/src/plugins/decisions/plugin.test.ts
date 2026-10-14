import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StageRecord } from '../../core/instrument.js';
import type { ArmSummary } from '../../core/report.js';
import { selectScenarios } from '../../core/scenarios.js';
import type { JevArm } from '../jev/arms.js';
import { jevPlugin } from '../jev/plugin.js';
import { decisionsPlugin, decisionsPluginWith } from './plugin.js';

function summaryOf(arm: string): ArmSummary {
  return { arm } as unknown as ArmSummary;
}

describe('the Decisions plugin', () => {
  test('offers the Decisions select, actions and layout stage evals with the Jev variants', () => {
    const modules = decisionsPlugin.stageModules ?? [];
    expect(modules.map((module) => module.name)).toEqual([
      'decisions-select',
      'decisions-actions',
      'decisions-layout',
      'decisions-select-prose',
    ]);
    const jevModules = jevPlugin.stageModules ?? [];
    for (const [index, module] of modules.slice(0, 3).entries()) {
      expect(module.provider).toBe('Decisions');
      expect(module.requiredEnv).toEqual(['OPENAI_API_KEY']);
      expect(module.stage).toBe(jevModules[index]?.stage ?? '');
      expect(module.variants).toEqual(jevModules[index]?.variants ?? []);
    }
  });

  test('offers the prose select stage eval on the select module and its variants', () => {
    const modules = decisionsPlugin.stageModules ?? [];
    const select = modules.find((module) => module.name === 'decisions-select');
    const prose = modules.find(
      (module) => module.name === 'decisions-select-prose',
    );
    expect(prose?.provider).toBe('Decisions');
    expect(prose?.requiredEnv).toEqual(['OPENAI_API_KEY']);
    expect(prose?.stage).toBe(select?.stage ?? '');
    expect(prose?.variants).toEqual(select?.variants ?? []);
  });

  test('prints the Decisions model and offers no judge, defaults or aliases', () => {
    expect(decisionsPlugin.name).toBe('decisions');
    expect(decisionsPlugin.meta?.()).toEqual({ decisionsModel: 'gpt-6-luna' });
    expect(
      decisionsPluginWith({
        decisions: { model: 'decisions-pinned' },
      }).meta?.(),
    ).toEqual({ decisionsModel: 'decisions-pinned' });
    expect(decisionsPlugin.judge).toBeUndefined();
    expect(decisionsPlugin.defaultArms).toBeUndefined();
    expect(decisionsPlugin.aliases).toBeUndefined();
  });

  test('adds no report rows when a Jev arm is in the report, and the Jev rows otherwise', () => {
    const labels = (summaries: readonly ArmSummary[]) =>
      (decisionsPlugin.reportRows?.(summaries) ?? []).map((row) => row.label);
    const jevLabels = (
      jevPlugin.reportRows?.([summaryOf('jev-poc')]) ?? []
    ).map((row) => row.label);
    expect(jevLabels.length).toBeGreaterThan(0);
    expect(labels([summaryOf('decisions-poc'), summaryOf('jev-poc')])).toEqual(
      [],
    );
    expect(labels([summaryOf('baseline'), summaryOf('decisions-poc')])).toEqual(
      jevLabels,
    );
  });

  test('gives the same report row labels as the TypeSafe plugin, which the row deferral relies on', () => {
    const summaries = [summaryOf('decisions-poc')];
    const labels = (plugin: typeof jevPlugin) =>
      (plugin.reportRows?.(summaries) ?? []).map((row) => row.label);
    expect(labels(decisionsPlugin).length).toBeGreaterThan(0);
    expect(labels(decisionsPlugin)).toEqual(labels(jevPlugin));
  });

  test('checks a replayed selection against a gated arm and names itself for an arm it does not own', () => {
    const record: StageRecord = {
      stage: 'jevSelect',
      ms: 0,
      outcome: 'ok',
      output: {},
    };
    const gated = (decisionsPlugin.arms as readonly JevArm[]).find(
      (arm) => arm.replayShape === 'gated',
    );
    if (gated === undefined) throw new Error('no gated Decisions arm');
    expect(decisionsPlugin.verifyReplay?.(record, gated)).toEqual([
      'has no complete gates',
    ]);
    expect(() =>
      decisionsPlugin.verifyReplay?.(record, { ...gated, name: 'jev-poc' }),
    ).toThrow(
      'the decisions plugin has no arm jev-poc to check a replayed stage output against',
    );
  });

  test('accepts only the Decisions arms for --spatial-records-arm', async () => {
    const layout = decisionsPlugin.stageModules?.[2];
    if (layout === undefined) throw new Error('no Decisions layout module');
    await expect(
      layout.configure(
        {
          'spatial-signal': 'recorded-live',
          'spatial-records': 'records.json',
          'spatial-records-arm': 'jev-poc',
        },
        { scenarios: [], repeats: 1 },
      ),
    ).rejects.toThrow(
      '--spatial-records-arm: unknown arm jev-poc; known arms: decisions-poc, decisions-composed-pairs',
    );
  });

  test('reads the composed pairs Decisions arm when --spatial-records-arm is absent', async () => {
    const layout = decisionsPlugin.stageModules?.[2];
    if (layout === undefined) throw new Error('no Decisions layout module');
    const dir = await mkdtemp(join(tmpdir(), 'decisions-plugin-'));
    try {
      const path = join(dir, 'records.json');
      await writeFile(path, '[]');
      await expect(
        layout.configure(
          { 'spatial-signal': 'recorded-live', 'spatial-records': path },
          { scenarios: selectScenarios('all', ['swap']), repeats: 1 },
        ),
      ).rejects.toThrow(
        `${path} holds no spatial gate recorded by arm decisions-composed-pairs`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
