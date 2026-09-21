import {
  createEngine,
  type Logger,
  llmPlanner,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
  withRetry,
} from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  isOk,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import type { StageName } from '../src/lib/defer.js';
import { buildJevPlanner, FALLBACK_RETRIES } from '../src/lib/jev-planner.js';
import type {
  JevActionPlan,
  JevLayoutPlan,
  JevSelection,
} from '../src/lib/types.js';
import type { JevCall } from '../src/lib/typesafe-client.js';
import { createRecorder, type StageRecord } from './instrument.js';
import type { Scenario, Suite } from './scenarios.js';
import {
  type Score,
  scoreActions,
  scoreLayout,
  scoreResponse,
  scoreSelection,
} from './score.js';

export type Arm = 'baseline' | 'jev';

/** The demo's system rules (apps/demo/src/server/engine-config.ts), so both arms prompt the LLM like the demo. */
export const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

export interface RunRecord {
  readonly scenarioId: string;
  readonly suite: Suite;
  readonly arm: Arm;
  readonly repeat: number;
  /** Wall time of `engine.handle` for the turn. */
  readonly turnMs: number;
  readonly userMessage?: string;
  readonly error?: { readonly tag: string; readonly message: string };
  /** The scenario expects the POC to defer; excluded from both arms' overall pass rate. */
  readonly expectedDeferral: boolean;
  /** Overall score of the shipped response (planned scenarios only). */
  readonly score?: Score;
  /** POC only: whether it deferred at the expected stage (expected-deferral scenarios). */
  readonly deferredAsExpected?: boolean;
  readonly deferral?: {
    readonly stage: StageName;
    readonly reason: string;
    readonly provider: boolean;
  };
  readonly fallbackCalls?: number;
  readonly stageScores?: {
    readonly selection?: Score;
    readonly actions?: Score;
    readonly layout?: Score;
  };
  readonly stages?: readonly Omit<StageRecord, 'output'>[];
  readonly stageOutputs?: Readonly<Record<string, unknown>>;
  readonly jevCalls?: readonly JevCall[];
  /** `stated_elsewhere` slots the actions stage left for the LLM, and how many it filled. */
  readonly fill?: { readonly slots: number; readonly filled: number };
  readonly tree?: readonly unknown[];
}

export interface EvalOptions {
  readonly scenarios: readonly Scenario[];
  readonly arms: readonly Arm[];
  readonly repeats: number;
  /** Text adapter for the baseline, `llmComplete` and the fallback. */
  readonly adapter: AnyTextAdapter;
  readonly typesafe: {
    readonly apiKey: string;
    readonly model: string;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  };
  readonly logger?: Logger;
  /** Called after every turn, for progress output. */
  readonly onRecord?: (record: RunRecord) => void;
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Runs every scenario `repeats` times through each arm and scores the
 * shipped response. Both arms plan through `createEngine` with history off
 * and `retry: false`: the baseline is the same once-retried `llmPlanner` the
 * POC falls back to, so the only difference between arms is the Jev
 * pipeline.
 */
export async function runEval(options: EvalOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const scenario of options.scenarios)
    for (let repeat = 1; repeat <= options.repeats; repeat++)
      for (const arm of options.arms) {
        const record =
          arm === 'baseline'
            ? await runBaseline(options, scenario, repeat)
            : await runJev(options, scenario, repeat);
        records.push(record);
        options.onRecord?.(record);
      }
  return records;
}

function fallbackPlanner(adapter: AnyTextAdapter) {
  return llmPlanner({
    adapter,
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
  });
}

async function runBaseline(
  options: EvalOptions,
  scenario: Scenario,
  repeat: number,
): Promise<RunRecord> {
  const planner = withRetry(fallbackPlanner(options.adapter), {
    max: FALLBACK_RETRIES,
  });
  const turn = await handle(options, scenario, repeat, 'baseline', planner);
  return {
    ...base(scenario, repeat, 'baseline', turn),
    ...(turn.response &&
      scenario.expected.status === 'planned' && {
        score: scoreResponse(scenario, turn.response),
      }),
  };
}

async function runJev(
  options: EvalOptions,
  scenario: Scenario,
  repeat: number,
): Promise<RunRecord> {
  const recorder = createRecorder();
  let fallbackCalls = 0;
  const fallback = fallbackPlanner(options.adapter);
  const counted: Stage<Retryable<PlanningInput>, PlannerCandidate> = (
    input,
    ctx,
  ) => {
    fallbackCalls += 1;
    return fallback(input, ctx);
  };
  const planner = buildJevPlanner(
    {
      typesafe: { ...options.typesafe, onCall: recorder.onCall },
      adapter: options.adapter,
      fallback: counted,
    },
    recorder.instrument,
  );
  const turn = await handle(options, scenario, repeat, 'jev', planner);

  const outputOf = <T>(stage: StageName) =>
    recorder.stages.find(
      (record) => record.stage === stage && record.outcome === 'ok',
    )?.output as T | undefined;
  const selection = outputOf<JevSelection>('jevSelect');
  const actions = outputOf<JevActionPlan>('jevActions');
  const layout = outputOf<JevLayoutPlan>('jevLayout');
  const deferredRecord = recorder.stages.find(
    (record) => record.outcome === 'deferred',
  );
  const deferral = deferredRecord?.reason
    ? {
        stage: deferredRecord.stage,
        reason: deferredRecord.reason,
        provider:
          deferredRecord.reason.split('/')[1]?.startsWith('provider_') ?? false,
      }
    : undefined;
  const expectedDeferral = scenario.expected.status === 'deferred';
  const fill = actions && fillOf(actions, recorder.stages);

  return {
    ...base(scenario, repeat, 'jev', turn),
    ...(turn.response &&
      !expectedDeferral && { score: scoreResponse(scenario, turn.response) }),
    ...(expectedDeferral && {
      deferredAsExpected:
        deferral !== undefined &&
        (scenario.expected.deferStage === undefined ||
          deferral.stage === scenario.expected.deferStage),
    }),
    ...(deferral && { deferral }),
    fallbackCalls,
    stageScores: {
      ...(selection && { selection: scoreSelection(scenario, selection) }),
      ...(actions && { actions: scoreActions(scenario, actions) }),
      ...(layout && { layout: scoreLayout(scenario, layout) }),
    },
    stages: recorder.stages.map(({ output: _output, ...rest }) => rest),
    stageOutputs: {
      ...(selection && {
        jevSelect: {
          instances: selection.instances,
          answers: selection.answers,
        },
      }),
      ...(actions && {
        jevActions: {
          actions: actions.actions,
          asks: actions.asks,
          answers: actions.answers,
        },
      }),
      ...(layout && {
        jevLayout: {
          layoutId: layout.layoutId,
          tree: layout.tree,
          answers: layout.answers,
        },
      }),
    },
    jevCalls: recorder.calls,
    ...(fill && { fill }),
  };
}

interface Turn {
  readonly ms: number;
  readonly response?: MaelstromResponse;
  readonly error?: { readonly tag: string; readonly message: string };
}

async function handle(
  options: EvalOptions,
  scenario: Scenario,
  repeat: number,
  arm: Arm,
  planner: Planner,
): Promise<Turn> {
  const withHistory: Planner = (input, ctx) =>
    planner(
      scenario.history ? { ...input, history: scenario.history } : input,
      ctx,
    );
  const engine = createEngine({
    planner: withHistory,
    retry: false,
    logger: options.logger ?? silent,
  });
  const started = performance.now();
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId(`eval-${arm}`),
      id: MessageId(`${scenario.id}-${arm}-${repeat}`),
      request: scenario.request,
    }),
  );
  const ms = performance.now() - started;
  if (isOk(result) && result.value.type === 'chart_response')
    return { ms, response: result.value.response };
  if (isOk(result))
    return {
      ms,
      error: { tag: 'UnexpectedOutput', message: result.value.type },
    };
  return {
    ms,
    error: { tag: result.error._tag, message: result.error.message },
  };
}

function base(
  scenario: Scenario,
  repeat: number,
  arm: Arm,
  turn: Turn,
): RunRecord {
  return {
    scenarioId: scenario.id,
    suite: scenario.suite,
    arm,
    repeat,
    turnMs: turn.ms,
    expectedDeferral: scenario.expected.status === 'deferred',
    ...(turn.response && {
      userMessage: turn.response.userMessage,
      tree:
        turn.response.layout.type === 'tiling' ? turn.response.layout.tree : [],
    }),
    ...(turn.error && { error: turn.error }),
  };
}

/**
 * Slots count as filled when `llmComplete` got past the fill: it returned a
 * candidate, or deferred for a reason other than `param_unfilled`. A
 * `param_unfilled` deferral counts every slot of that turn as unfilled. A
 * turn that never reached `llmComplete`, or whose call failed, is left out.
 */
function fillOf(
  actions: JevActionPlan,
  stages: readonly StageRecord[],
): { slots: number; filled: number } | undefined {
  const complete = stages.find((record) => record.stage === 'llmComplete');
  if (complete === undefined || complete.outcome === 'error') return undefined;
  const slots = actions.actions.reduce(
    (count, action) => count + action.pending.length,
    0,
  );
  return {
    slots,
    filled: complete.reason === 'llmComplete/param_unfilled' ? 0 : slots,
  };
}
