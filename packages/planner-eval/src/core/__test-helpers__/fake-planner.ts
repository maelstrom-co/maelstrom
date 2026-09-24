import {
  deferred,
  type PlannerCandidate,
  type PlanningInput,
  pipeline,
  type Stage,
  withFallback,
} from '@maelstrom-co/engine';
import { err, ok } from '@maelstrom-co/protocol';
import type {
  Arm,
  Judge,
  JudgeInput,
  JudgeVerdict,
  PlannerEvalPlugin,
  ProviderCall,
  ReportRow,
} from '../plugin.js';
import {
  spread,
  spreadOf,
  type TokenTotals,
  tokenTotals,
  totals,
} from '../report.js';

/** What the fake pipeline reports of each call it makes. */
export interface FakeCall extends ProviderCall {
  readonly stage: string;
}

/** What the fake pipeline does on every turn. */
export interface FakeScript {
  /** The candidate the `write` stage, and the baseline, return. */
  readonly candidate: (input: PlanningInput) => PlannerCandidate;
  /** Defer at this stage with `<stage>/<code>` instead of producing an output. */
  readonly deferAt?: 'pick' | 'write';
  /** The deferral code; `no_pick` or `no_layout` when absent. */
  readonly code?: string;
}

/** The fake pipeline's stages, in order: `pick` chooses instances, `write` returns the candidate. */
export const FAKE_STAGES = ['pick', 'write'] as const;

/** A candidate that sets the weather to Tokyo and keeps the default board, passing `quoted-location`. */
export const TOKYO_CANDIDATE = {
  userMessage: 'Tokyo it is.',
  rationale: 'r',
  executionPlan: [
    {
      instanceId: 'weather-main',
      action: 'setLocation',
      paramsJson: '{"location":"Tokyo"}',
    },
  ],
  layout: {
    tree: ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
      { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
      { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
      { instanceId: 'journal-main', vesselId: 'journal', variant: 'list' },
    ],
  },
} as unknown as PlannerCandidate;

interface Picked {
  readonly input: PlanningInput;
  readonly picked: readonly string[];
}

/**
 * A two-stage planner family as an eval plugin, exercising every seam:
 * `fake-baseline` returns the scripted candidate outright, `fake` and
 * `fake-poc` pick the request's instances then write the candidate, each
 * stage reporting one call, and fall back on a scripted deferral.
 */
export function fakePluginWith(
  script: FakeScript,
): PlannerEvalPlugin<FakeCall> {
  const staged = (name: string, kind?: string): Arm<FakeCall> => ({
    name,
    ...(kind && { kind }),
    requiredEnv: ['FAKE_KEY'],
    build(deps) {
      const pick: Stage<PlanningInput, Picked> = async (input) => {
        deps.onCall({
          stage: 'pick',
          latencyMs: 5,
          usage: { inputTokens: 10, outputTokens: 1 },
        });
        if (script.deferAt === 'pick')
          return err(deferred(`pick/${script.code ?? 'no_pick'}`));
        return ok({
          input,
          picked: input.request.instances.map((instance) =>
            String(instance.instanceId),
          ),
        });
      };
      const write: Stage<Picked, PlannerCandidate> = async ({ input }) => {
        deps.onCall({ stage: 'write', latencyMs: 7 });
        if (script.deferAt === 'write')
          return err(deferred(`write/${script.code ?? 'no_layout'}`));
        return ok(script.candidate(input));
      };
      return withFallback(
        pipeline(
          deps.instrument('pick', pick),
          deps.instrument('write', write),
        ),
        deps.fallback,
      );
    },
  });
  return {
    name: 'fake',
    arms: [
      {
        name: 'fake-baseline',
        baseline: true,
        requiredEnv: ['FAKE_KEY'],
        build: () => async (input) => ok(script.candidate(input)),
      },
      staged('fake'),
      staged('fake-poc', 'fake-poc'),
    ],
    defaultArms: ['fake'],
    aliases: { poc: 'fake-poc' },
    stageOrder: FAKE_STAGES,
    phases: { select: 'pick', layout: 'write' },
    meta: () => ({ fakeModel: 'fake-1' }),
    verifyReplay: (record) =>
      record.stage === 'pick' &&
      !Array.isArray((record.output as Partial<Picked> | undefined)?.picked)
        ? ['has no picked']
        : [],
    recordTurn: (_scenario, stages, calls) => ({
      picked:
        (
          stages.find(
            (record) => record.stage === 'pick' && record.outcome === 'ok',
          )?.output as Picked | undefined
        )?.picked ?? [],
      fakeCalls: calls,
    }),
    summarizeArm: (records) => {
      const calls = records.flatMap(
        (record) => (record.fakeCalls as readonly FakeCall[] | undefined) ?? [],
      );
      return {
        picks: records.reduce(
          (total, record) =>
            total +
            ((record.picked as readonly string[] | undefined)?.length ?? 0),
          0,
        ),
        latency: { fakeCall: spreadOf(calls.map((call) => call.latencyMs)) },
        tokens: { fake: tokenTotals(calls) },
      };
    },
    reportRows: () => [
      {
        label: 'Fake picks',
        cell: (s) => (s.picks === undefined ? 'n/a' : String(s.picks)),
      },
      ...FAKE_STAGES.map(
        (stage): ReportRow => ({
          label: `${stage} latency p50 / p95 (ms)`,
          section: 'latency',
          cell: (s) => {
            const live = s.latency.stages?.[stage];
            if (live && live.samples > 0) return spread(live);
            return s.replayed.includes(stage) ? 'replayed' : 'n/a';
          },
        }),
      ),
      {
        label: 'Fake calls / input / output tokens',
        section: 'tokens',
        cell: (s) => {
          const fake = s.tokens.fake as TokenTotals | undefined;
          return fake ? totals(fake) : 'n/a';
        },
      },
    ],
    judge: scriptedJudge(() => ({
      answers: {
        request_satisfied: { score: 4, probabilities: { '4': 1 } },
        arrangement_match: { score: 4, probabilities: { '4': 1 } },
      },
      calls: [{ latencyMs: 3 }],
    })),
  };
}

/** A judge that answers from `script`, keeping every input it was asked. */
export function scriptedJudge(
  script: (input: JudgeInput, call: number) => JudgeVerdict,
): Judge & { readonly inputs: JudgeInput[] } {
  const inputs: JudgeInput[] = [];
  return {
    inputs,
    requiredEnv: ['FAKE_JUDGE_KEY'],
    async score(input) {
      inputs.push(input);
      return script(input, inputs.length - 1);
    },
  };
}
