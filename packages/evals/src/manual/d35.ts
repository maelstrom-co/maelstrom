import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import {
  createEngine,
  createInMemoryStore,
  type LLMContextMessage,
} from '@maelstrom-co/engine';
import { buildSystemPrompt, llmPlanner } from '@maelstrom-co/planner-llm';
import {
  type ChartRequest,
  ChartRequestMessage,
  ChartRequestSchema,
  isErr,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  scoreThreeVesselAddition,
  threeVesselAdditionCatalogSchema,
  threeVesselAdditionExpectationsSchema,
  threeVesselAdditionInputsSchema,
} from '../adapters/three-vessel-addition.js';
import { evalCaseSchema } from '../core/case-schema.js';
import { evaluateSample, type Verdict } from '../core/runtime/evaluate.js';
import { request } from '../core/scenarios.js';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type ManualFetch, manualTransport } from './transport.js';

const model = 'gpt-6-luna';
const maxOutputTokens = 2048;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const prompt = { system: { rules: { append: SYSTEM_RULES } } };
const intents = [
  'Add my lab results and calendar to the weather view.',
  'Switch the weather to weekly forecast.',
  'Show me the week view in the calendar.',
] as const;

function definition() {
  const value = evalCaseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../cases/v1/three-vessel-addition.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  threeVesselAdditionInputsSchema.parse(value.inputs);
  threeVesselAdditionExpectationsSchema.parse(value.expectations);
  if (
    value.id !== 'three-vessel-addition' ||
    value.profile !== 'three-vessel-addition' ||
    !isDeepStrictEqual(value.lineage, [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        taskId: 'cap-maelstrom-multivessel-three',
        datasetId: 'cap-maelstrom-multivessel-three',
        pointer: '/items/34',
      },
    ])
  )
    throw new Error('D35 case contract changed; review before dispatch');
  return value;
}

async function initialRequest(intent: string): Promise<ChartRequest> {
  // Fixed runtime URLs avoid pulling the demo into the eval TypeScript build graph.
  const weather: { weatherVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const labs: { labsVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/labs.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const calendar: { calendarVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/calendar.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const vessels = threeVesselAdditionCatalogSchema.parse([
    weather.weatherVessel,
    labs.labsVessel,
    calendar.calendarVessel,
  ]);
  return request(intent, {
    vessels,
    instances: ['weather'],
    variants: { weather: 'current' },
    tree: ['ID:weather-main'],
    columns: 30,
    rows: 18,
  });
}

function verifyModel(env: Readonly<Record<string, string | undefined>>) {
  const source = readFileSync(
    new URL(
      '../../../../apps/demo/src/server/engine-model.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const currentDefault = source.match(
    /export const DEFAULT_ENGINE_MODEL = '([^']+)'/,
  )?.[1];
  if (
    currentDefault !== model ||
    (env.ENGINE_MODEL?.trim() || currentDefault) !== model
  )
    throw new Error('Current Engine model changed; review D35 before dispatch');
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'D35 requires the official endpoint without custom headers',
    );
}

/** A completed current-Engine turn, with independently captured planner input history. */
export interface D35Turn {
  /** Zero-based position in the fixed user-turn sequence. */
  readonly index: number;
  /** Unique Engine message identity within this sample. */
  readonly requestId: string;
  /** Request sent to the Engine, before processing. */
  readonly request: ChartRequest;
  /** Actual prior messages handed by the Engine to the planner, not a seeded transcript. */
  readonly history: readonly LLMContextMessage[];
  /** Actual shipped response after Engine validation/healing. */
  readonly response: MaelstromResponse;
}

function turnRequest(
  initial: ChartRequest,
  intent: string,
  previous?: MaelstromResponse,
): ChartRequest {
  return ChartRequestSchema.parse({
    ...structuredClone(initial),
    ...(previous && {
      layout: structuredClone(previous.layout),
      instances:
        previous.layout.type === 'tiling'
          ? structuredClone(previous.layout.instances)
          : [],
    }),
    context: {
      ...initial.context,
      updateReasons: [{ type: 'user_intent', intent }],
    },
  });
}

/** Shared adjudicated membership/Action predicate plus exact request and naturally retained history delivery. */
export function scoreD35Turns(
  turns: readonly D35Turn[],
  initial: ChartRequest,
): Verdict {
  const failures: string[] = [];
  const prior: LLMContextMessage[] = [];
  const state = (layout: MaelstromResponse['layout']) => ({
    layout: {
      type: layout.type,
      instances: layout.type === 'tiling' ? layout.instances : [],
    },
  });
  for (const [index, turn] of turns.entries()) {
    if (index >= intents.length) break;
    try {
      if (
        turn.index !== index ||
        !isDeepStrictEqual(
          turn.request,
          turnRequest(initial, intents[index], turns[index - 1]?.response),
        )
      )
        failures.push(
          `Request/order/state carry-forward mismatch at turn ${index + 1}`,
        );
    } catch {
      failures.push(`Invalid prior Chart state at turn ${index + 1}`);
    }
    if (!isDeepStrictEqual(turn.history, prior))
      failures.push(
        `Prior user/assistant history not delivered at turn ${index + 1}`,
      );
    prior.push(
      { role: 'user', content: intents[index] },
      { role: 'assistant', content: turn.response.userMessage },
    );
  }
  const verdict = scoreThreeVesselAddition(
    turns.map((turn) => ({
      index: turn.index,
      input: {
        intent: turn.request.context.updateReasons.find(
          (reason) => reason.type === 'user_intent',
        )?.intent,
      },
      state: state(turn.request.layout),
      output: {
        ...state(turn.response.layout),
        executionPlan: turn.response.executionPlan,
      },
      resultingState: state(turn.response.layout),
    })),
    state(initial.layout),
    initial.vessels,
    { turns: intents.map((intent) => ({ intent })) },
    {
      coverage: 'COMPLETE',
      initialScene: 'weather-only',
      labsPreservationBaseline: 'after-addition',
      weatherAction: 'showWeekly',
      calendarAction: 'showWeek',
    },
  );
  failures.push(...verdict.failures);
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** One adjudicated D35 sequence of three source prompts; dry-run never reads credentials or creates a provider. */
export async function runD35(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: ManualFetch = globalThis.fetch,
) {
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !['--live', '--confirm-capped-key'].includes(arg)) ||
    (args.includes('--confirm-capped-key') && !args.includes('--live'))
  )
    throw new Error('Usage: d35.ts [--live --confirm-capped-key]');
  verifyModel(env);
  const value = definition();
  const initial = await initialRequest(intents[0]);
  const configuration = {
    sample: 'D35',
    initialScene: 'user-adjudicated-weather-only',
    labsPreservationBaseline: 'after-addition',
    caseId: value.id,
    model,
    prompts: [...intents],
    initialRequest: structuredClone(initial),
    systemPrompt: buildSystemPrompt('tiling', prompt),
    maxOutputTokens,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 3,
    deterministicPredicate:
      'adjudicated-addition + pre-turn-valid-actions + exact-membership/variants + request/history carry-forward',
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; actual demo Weather/no-data Labs/Calendar catalogs; three source prompts; user-adjudicated initial scene; default identity and current eval SYSTEM_RULES; not demo-factory parity',
    source: value.lineage,
  };
  if (!args.includes('--live'))
    return { mode: 'dry-run' as const, configuration, generationDispatches: 0 };
  if (!args.includes('--confirm-capped-key'))
    throw new Error('Live D35 requires prior external capped-key confirmation');
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live D35');

  const transport = manualTransport(send, apiKey, model, maxOutputTokens, 3);
  const sessionId = SessionId(`d35-${crypto.randomUUID()}`);
  const turns: D35Turn[] = [];
  const result = await evaluateSample(
    {
      runId: sessionId,
      caseId: value.id,
      runtimeId: `current-engine/${model}`,
      sample: 1,
    },
    {
      surface: 'session',
      provenance: configuration.provenance,
      async execute(context) {
        let index = 0;
        try {
          const adapter = createOpenaiChat(model, apiKey, {
            baseURL: 'https://api.openai.com/v1',
            maxRetries: 0,
            timeout: 30_000,
            logLevel: 'off',
            logger: silent,
            fetch: transport.fetch,
          });
          const planner = llmPlanner({
            adapter,
            prompt,
            modelOptions: {
              max_output_tokens: maxOutputTokens,
              service_tier: 'default',
              store: false,
              include: [],
            },
          });
          let plannerHistory: readonly LLMContextMessage[] | undefined;
          const engine = createEngine({
            planner: (input, ctx) => {
              plannerHistory = structuredClone(input.history);
              context.record({
                kind: 'diagnostic',
                requestId: input.messageId,
                value: {
                  type: 'planner-input',
                  request: input.request,
                  history: plannerHistory,
                },
              });
              return planner(input, ctx);
            },
            retry: false,
            logger: silent,
            history: { store: createInMemoryStore(), maxEntries: 20 },
          });
          for (; index < intents.length; index++) {
            const input = turnRequest(
              initial,
              intents[index],
              turns[index - 1]?.response,
            );
            const requestId = MessageId(`${sessionId}-turn-${index + 1}`);
            const signal = AbortSignal.timeout(35_000);
            plannerHistory = undefined;
            transport.beginTurn(index);
            const response = await engine.handle(
              ChartRequestMessage({
                sessionId,
                id: requestId,
                request: structuredClone(input),
              }),
              signal,
            );
            transport.assertDispatched();
            if (
              signal.aborted ||
              isErr(response) ||
              response.value.type !== 'chart_response' ||
              plannerHistory === undefined
            )
              throw new Error('D35 Engine request did not complete');
            const turn: D35Turn = {
              index,
              requestId,
              request: input,
              history: structuredClone(plannerHistory),
              response: structuredClone(response.value.response),
            };
            turns.push(turn);
            context.record({ kind: 'turn', requestId, value: turn });
          }
          return {
            completeness: 'complete' as const,
            disposition: 'planned' as const,
            value: turns,
          };
        } catch {
          return {
            completeness: turns.length
              ? ('partial' as const)
              : ('absent' as const),
            disposition: 'planned' as const,
            value: turns,
            error: `D35 stopped at turn ${index + 1}; incomplete evidence; no retry`,
          };
        }
      },
      score: (observed) => scoreD35Turns(observed, initial),
    },
  );
  return {
    mode: 'live' as const,
    configuration,
    generationDispatches: transport.count(),
    result,
    semanticReview: {
      status:
        result.completeness === 'complete'
          ? ('pending-human-review' as const)
          : ('unavailable' as const),
      criteria: [
        'Describes only adding the two Instances, Weather weekly and Calendar week; no invented lab results or clinical advice.',
        'New demo Labs has no clinical data. Unscored extra non-transition Action effects require separate review.',
      ],
      assistantTexts: turns.map(({ response }) => response.userMessage),
    },
    limitation:
      "D35 is COMPLETE only for the user-adjudicated current contract after one fresh post-fix current-Engine sample passed in three dispatches with no retry; prior failed reports remain preserved. This does not predetermine this run's verdict or semantic review, which remains pending for complete evidence; no user semantic acceptance is implied. Three exact source prompts; Weather-only start was user-adjudicated and Labs preservation starts after addition. The legacy TASK_DEFINITIONS task preloads all three and scores a different flow. No source scorer/runtime equivalence or demo-factory parity, clinical data/trend fulfillment, client/handler execution, geometry, unscored Action-parameter/effect or reliability claim. Engine healing can alter raw candidates.",
  };
}

if (import.meta.main) {
  try {
    const report = await runD35(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'D35 did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
