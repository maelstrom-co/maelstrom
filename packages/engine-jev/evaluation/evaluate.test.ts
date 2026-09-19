import { describe, expect, test } from 'bun:test';
import { MaelstromResponseSchema } from '@maelstrom-co/protocol';
import { evaluate, models } from './evaluate.js';
import { type Fixture, fixtures, freeze } from './fixtures.js';

function find(id: string): Fixture {
  const fixture = fixtures.find((value) => value.id === id);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return fixture;
}

describe('offline public planner evaluation', () => {
  test('detects schema-valid semantic errors without treating negative probes as regressions', async () => {
    const report = await evaluate({
      audit(event) {
        if (event.payload)
          expect(JSON.stringify(event.payload)).not.toMatch(
            /planRequired|expectedNegative|mistakes|regressions|labelFor/,
          );
      },
    });
    expect(report.regressions).toEqual([]);
    expect(report.exitCode).toBe(0);
    expect(report.liveCalls).toBe(0);
    expect(report.models).toEqual(models);
    expect(report.cost).toMatchObject({
      status: 'unknown',
      verifiedPriceInputs: null,
      providerTokens: null,
    });
    for (const backend of ['llm', 'jev'] as const) {
      const rows = report.rows.filter((row) => row.backend === backend);
      for (const [id, mistake] of [
        ['wrong-layout', 'layout'],
        ['wrong-retention', 'layout'],
        ['wrong-arrangement', 'layout'],
        ['wrong-action', 'actions'],
        ['wrong-parameter', 'parameters'],
      ]) {
        const row = rows.find((value) => value.caseId === id);
        expect(row?.terminal).toBe('accepted');
        expect(MaelstromResponseSchema.safeParse(row?.response).success).toBe(
          true,
        );
        expect(row?.mistakes).toEqual([mistake]);
        expect(row?.useful).toBe(false);
        expect(row?.expectedNegative).toBe(true);
      }
      expect(report.summaries[backend]).toMatchObject({
        incorrectAcceptedLayouts: 3,
        incorrectAcceptedActions: 1,
        incorrectAcceptedParameters: 1,
        providerFailures: 1,
        malformedProviderResponses: 1,
        regressions: 0,
      });
    }
    expect(report.summaries.jev).toMatchObject({
      candidateGaps: 1,
      unnecessaryDeferrals: 1,
      capabilityDeferrals: 1,
    });
  });

  test('fails when a formerly correct provider script changes observable behavior', async () => {
    const good = find('preserve');
    const bad = find('wrong-layout');
    const report = await evaluate({
      fixtures: [{ ...good, script: bad.script }],
    });
    expect(report.exitCode).toBe(1);
    expect(report.regressions).toHaveLength(2);
    for (const row of report.rows) {
      expect(row.terminal).toBe('accepted');
      expect(row.mistakes).toEqual(['layout']);
      expect(row.regressions).toContain(
        'semantic error classification differs',
      );
    }
  });

  test('fails if a negative semantic probe stops exercising its intended error', async () => {
    const bad = find('wrong-layout');
    const good = find('preserve');
    const report = await evaluate({
      fixtures: [{ ...bad, script: good.script }],
    });
    expect(report.exitCode).toBe(1);
    expect(report.rows.every((row) => row.mistakes.length === 0)).toBe(true);
    expect(report.regressions).toHaveLength(2);
  });

  test('sends shared immutable snapshots and retained context without evaluation labels', async () => {
    const snapshots: unknown[] = [];
    const payloads: { backend: string; payload: unknown }[] = [];
    const fixture = find('history-follow-up');
    const before = JSON.stringify(fixture);
    const report = await evaluate({
      fixtures: [fixture],
      audit(event) {
        if (event.input) {
          expect(Object.isFrozen(event.input)).toBe(true);
          expect(Object.isFrozen(event.input.request)).toBe(true);
          expect(Object.isFrozen(event.input.actionEnums)).toBe(true);
          expect(event.input.actionEnums.length).toBeGreaterThan(0);
          expect(event.input.history.structured).toHaveLength(1);
          expect(event.input.history.conversation).toHaveLength(2);
          snapshots.push(event.input);
        }
        if (event.payload)
          payloads.push({ backend: event.backend, payload: event.payload });
      },
    });
    expect(report.exitCode).toBe(0);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(JSON.stringify(fixture)).toBe(before);
    for (const { payload } of payloads) {
      const serialized = JSON.stringify(payload);
      expect(serialized).toContain('Tokyo');
      expect(serialized).not.toMatch(
        /planRequired|expectedNegative|mistakes|regressions|labelFor|history-follow-up/,
      );
    }
    expect(payloads.some((p) => p.backend === 'llm')).toBe(true);
    expect(payloads.some((p) => p.backend === 'jev')).toBe(true);
  });

  test('strict rejection, fallback, cancellation, and budgets never persist partial or failed turns', async () => {
    const report = await evaluate({
      fixtures: fixtures.filter((f) =>
        [
          'strict-rejection',
          'strict-fallback',
          'fallback',
          'cancel',
          'stage-budget',
          'fallback-budget',
        ].includes(f.id),
      ),
    });
    expect(report.regressions).toEqual([]);
    for (const row of report.rows) {
      expect(row.persistedTurns).toBe(row.terminal === 'accepted' ? 1 : 0);
      expect(row.logicalCalls).toBe(row.transportCalls);
      expect(row.fallbackInvocations).toBeLessThanOrEqual(1);
      if (row.caseId === 'cancel') {
        expect(row.terminal).toBe('CancellationError');
        expect(row.logicalCalls).toBe(1);
        expect(row.fallbackInvocations).toBe(0);
        expect(row.transportAbortObserved).toBe(true);
      }
      if (row.caseId === 'strict-rejection')
        expect(row.reason).toBe('invalid_plan');
      if (row.caseId === 'strict-fallback' || row.caseId === 'fallback') {
        expect(row.logicalCalls).toBe(
          row.caseId === 'strict-fallback' && row.backend === 'jev' ? 1 : 2,
        );
        expect(row.fallbackCalls).toBe(1);
      }
      if (row.terminal === 'PlanningBudgetExceededError')
        expect(row.fallbackCalls).toBe(0);
    }
  });

  test('distinguishes compiler/finalizer rejection from accepted semantic errors', async () => {
    const positive = find('preserve');
    const invalid = find('strict-rejection');
    const report = await evaluate({
      fixtures: [
        freeze({
          ...positive,
          request: invalid.request,
          script: invalid.script,
        }),
      ],
    });
    expect(report.exitCode).toBe(1);
    for (const row of report.rows) {
      expect(row.terminal).toBe('PlanningDeferredError');
      expect(row.reason).toBe('invalid_plan');
      expect(row.mistakes).toEqual([]);
    }
    expect(report.summaries.jev.compilerFinalizerFailures).toBe(1);
    expect(report.summaries.jev.incorrectAcceptedLayouts).toBe(0);
  });

  test('CLI emits parseable JSON, summarizes expected negatives, and rejects live flags', async () => {
    const child = Bun.spawn([process.execPath, `${import.meta.dir}/cli.ts`], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const report = await new Response(child.stdout).json();
    const summary = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(report).toMatchObject({ regressions: [], exitCode: 0 });
    expect(summary).toContain('0 live calls');
    expect(summary).toContain('expected negatives');
    const denied = Bun.spawn(
      [process.execPath, `${import.meta.dir}/cli.ts`, '--live'],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    expect(await denied.exited).toBe(2);
    expect(await new Response(denied.stdout).text()).toBe('');
    expect(await new Response(denied.stderr).text()).toContain(
      'Live mode is unavailable',
    );
  });
});
