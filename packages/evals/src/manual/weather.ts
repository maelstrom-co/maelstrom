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
  VariantName,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  constraintExpectationsSchema,
  constraintInputsSchema,
} from '../adapters/legacy-response-constraint.js';
import {
  weatherTransitionChainExpectationsSchema,
  weatherTransitionChainInputsSchema,
} from '../adapters/legacy-weather-transition-chain.js';
import {
  scoreWeatherActionBackedResponse,
  weatherActionBackedExpectationsSchema,
  weatherActionBackedInputsSchema,
} from '../adapters/weather-action-backed-transition.js';
import { evalCaseSchema } from '../core/case-schema.js';
import { evaluateSample, type Verdict } from '../core/runtime/evaluate.js';
import { request } from '../core/scenarios.js';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type ManualJudgeOptions, manualJudge } from './judge.js';
import { type ManualFetch, manualTransport } from './transport.js';

const model = 'gpt-6-luna';
const maxOutputTokens = 2048;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const prompt = { system: { rules: { append: SYSTEM_RULES } } };
const samples = {
  D38: {
    caseId: 'weather-current-noop-subset',
    profile: 'legacy-response-constraint',
    pointer: '/items/37',
    intents: ['Show current weather'],
    actions: [undefined],
    variants: ['current'],
    maxTurns: 1,
  },
  D39: {
    caseId: 'weather-action-backed-transition',
    profile: 'weather-action-backed-transition',
    pointer: '/items/38',
    intents: ['Skip to weekly forecast'],
    actions: ['showWeekly'],
    variants: ['weekly'],
    maxTurns: 1,
  },
  D40: {
    caseId: 'weather-deterministic-cycle',
    profile: 'legacy-weather-transition-chain',
    pointer: '/items/39',
    trajectory: 'hourly-weekly-current',
    intents: [
      'Show me the hourly forecast',
      'Now go straight to weekly',
      'Go back to current',
    ],
    actions: ['showHourly', 'showWeekly', 'showCurrent'],
    variants: ['hourly', 'weekly', 'current'],
    maxTurns: 3,
  },
  D41: {
    caseId: 'weather-deterministic-return',
    profile: 'legacy-weather-transition-chain',
    pointer: '/items/40',
    trajectory: 'hourly-current-weekly',
    intents: [
      'Show hourly',
      'Just show current right now - skip weekly',
      'Go to weekly',
    ],
    actions: ['showHourly', 'showCurrent', 'showWeekly'],
    variants: ['hourly', 'current', 'weekly'],
    maxTurns: 3,
  },
} as const;

/** Separately selected Weather experiments; selection never runs a batch. */
export type WeatherSampleCase = keyof typeof samples;

function selection(args: readonly string[]): WeatherSampleCase {
  let selected: WeatherSampleCase | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error('Duplicate manual argument');
    seen.add(flag);
    if (flag === '--case') {
      const value = args[++index];
      if (
        value !== 'D38' &&
        value !== 'D39' &&
        value !== 'D40' &&
        value !== 'D41'
      )
        throw new Error('Select D38, D39, D40 or D41');
      selected = value;
    } else if (flag !== '--live' && flag !== '--confirm-capped-key') {
      throw new Error('Unknown manual argument');
    }
  }
  if (!selected || (seen.has('--confirm-capped-key') && !seen.has('--live')))
    throw new Error(
      'Usage: weather.ts --case D38|D39|D40|D41 [--live --confirm-capped-key]',
    );
  return selected;
}

function definition(selected: WeatherSampleCase) {
  const sample = samples[selected];
  const value = evalCaseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../cases/v1/${sample.caseId}.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  const intents =
    selected === 'D38'
      ? [constraintInputsSchema.parse(value.inputs).intent]
      : selected === 'D39'
        ? [weatherActionBackedInputsSchema.parse(value.inputs).intent]
        : weatherTransitionChainInputsSchema
            .parse(value.inputs)
            .turns.map(({ intent }) => intent);
  const expected =
    selected === 'D38'
      ? constraintExpectationsSchema.parse(value.expectations).rule === 'no-op'
      : selected === 'D39'
        ? weatherActionBackedExpectationsSchema.parse(value.expectations)
            .rule === 'matching-weekly-transition'
        : weatherTransitionChainExpectationsSchema.parse(value.expectations)
            .trajectory === samples[selected].trajectory;
  if (
    value.id !== sample.caseId ||
    value.profile !== sample.profile ||
    !expected ||
    !isDeepStrictEqual(intents, [...sample.intents]) ||
    !isDeepStrictEqual(value.lineage, [
      {
        source: 'legacy',
        revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
        path: 'langfuse/maelstrom-eval-dataset.v1.json',
        taskId: 'cap-maelstrom-edge-deterministic-actions',
        datasetId: 'cap-maelstrom-edge-deterministic-actions',
        pointer: sample.pointer,
      },
    ])
  )
    throw new Error('Weather case contract changed; review before dispatch');
  return { value, intents };
}

async function initialRequest(intent: string): Promise<ChartRequest> {
  // Fixed runtime URL avoids pulling the demo into the eval TypeScript build graph.
  const weather: { weatherVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
      import.meta.url,
    ).href
  );
  return request(intent, {
    vessels: [VesselSchema.parse(weather.weatherVessel)],
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
    throw new Error(
      'Current Engine model changed; review Weather samples before dispatch',
    );
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'Weather samples require the official endpoint without custom headers',
    );
}

/** A completed current-Engine turn, with independently captured planner input history. */
export interface WeatherSampleTurn {
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

/** Shipped Chart/Action and natural-history checks; D39 scores matching transition/membership only. */
export function scoreWeatherTurns(
  selected: WeatherSampleCase,
  turns: readonly WeatherSampleTurn[],
  initial: ChartRequest,
): Verdict {
  const sample = samples[selected];
  const failures: string[] = [];
  if (turns.length !== sample.maxTurns)
    failures.push(`Expected ${sample.maxTurns} completed turns`);
  const prior: LLMContextMessage[] = [];
  for (const [index, turn] of turns.entries()) {
    if (index >= sample.maxTurns) break;
    const intent = sample.intents[index];
    try {
      if (
        turn.index !== index ||
        !isDeepStrictEqual(
          turn.request,
          turnRequest(initial, intent, turns[index - 1]?.response),
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
    const action = sample.actions[index];
    const variant = sample.variants[index];
    const plan =
      action === undefined ? [] : [{ instanceId: 'weather-main', action }];
    if (selected === 'D39') {
      failures.push(
        ...scoreWeatherActionBackedResponse({
          executionPlan: turn.response.executionPlan,
          layout: {
            type: turn.response.layout.type,
            instances:
              turn.response.layout.type === 'tiling'
                ? turn.response.layout.instances
                : [],
          },
        }).failures,
      );
    } else if (!isDeepStrictEqual(turn.response.executionPlan, plan))
      failures.push(`Execution Plan mismatch at turn ${index + 1}`);
    if (action !== undefined) {
      const incoming = turn.request.instances.find(
        ({ instanceId }) => instanceId === 'weather-main',
      );
      const vessel = turn.request.vessels.find(
        ({ id }) => id === incoming?.vesselId,
      );
      const offered =
        incoming &&
        vessel?.variants[incoming.variant]?.actions.find(
          ({ name }) => name === action,
        );
      if (offered?.transitionsTo !== variant)
        failures.push(
          `Action unavailable for incoming Variant at turn ${index + 1}`,
        );
    }
    const instances = initial.instances.map((instance) => ({
      ...instance,
      variant: VariantName(variant),
    }));
    if (
      selected !== 'D39' &&
      (!isDeepStrictEqual(turn.response.layout, {
        ...initial.layout,
        instances,
      }) ||
        turn.response.layout.type !== 'tiling' ||
        !isDeepStrictEqual(turn.response.layout.instances, instances))
    )
      failures.push(
        `Chart layout/Instance snapshot mismatch at turn ${index + 1}`,
      );
    prior.push(
      { role: 'user', content: intent },
      { role: 'assistant', content: turn.response.userMessage },
    );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Runs one selected Weather sample; dry-run neither reads credentials nor creates a provider. */
export async function runWeatherSample(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: ManualFetch = globalThis.fetch,
  judgingOptions: ManualJudgeOptions = {},
) {
  const selected = selection(args);
  const sample = samples[selected];
  verifyModel(env);
  const { value, intents } = definition(selected);
  const initial = await initialRequest(intents[0]);
  const configuration = {
    sample: selected,
    caseId: value.id,
    model,
    prompts: [...intents],
    initialRequest: structuredClone(initial),
    systemPrompt: buildSystemPrompt('tiling', prompt),
    maxOutputTokens,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: sample.maxTurns,
    deterministicPredicate:
      selected === 'D38'
        ? 'empty-plan + exact-shipped-chart-preservation + request/history carry-forward'
        : selected === 'D39'
          ? 'matching-pre-turn-valid-showWeekly + existing-Weather-weekly + request/history; extra-actions/params/geometry-unscored'
          : 'exact-pre-turn-valid-actions + exact-shipped-chart/variants + request/history carry-forward',
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; actual demo Weather catalog; default identity and current eval SYSTEM_RULES; not demo-factory parity',
    source: value.lineage,
  };
  if (!args.includes('--live'))
    return {
      mode: 'dry-run' as const,
      configuration,
      generationDispatches: 0,
      judge: {
        schemaVersion: 1,
        status: 'not_run',
        reason: 'dry_run',
      } as const,
    };
  if (!args.includes('--confirm-capped-key'))
    throw new Error(
      'Live Weather samples require prior external capped-key confirmation',
    );
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new Error('OPENAI_API_KEY is required for live Weather samples');

  const judging = manualJudge(value, env, judgingOptions);
  const transport = manualTransport(
    send,
    apiKey,
    model,
    maxOutputTokens,
    sample.maxTurns,
  );
  const sessionId = SessionId(
    `${selected.toLowerCase()}-${crypto.randomUUID()}`,
  );
  const turns: WeatherSampleTurn[] = [];
  const result = await evaluateSample(
    {
      runId: sessionId,
      caseId: value.id,
      runtimeId: `current-engine/${model}`,
      sample: 1,
    },
    {
      ...(judging.judge && { judge: judging.judge }),
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
              throw new Error('Weather Engine request did not complete');
            const turn: WeatherSampleTurn = {
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
            error: `${selected} stopped at turn ${index + 1}; incomplete evidence; no retry`,
          };
        }
      },
      score: (observed) => scoreWeatherTurns(selected, observed, initial),
    },
  );
  return {
    mode: 'live' as const,
    configuration,
    generationDispatches: transport.count(),
    judgeCalls: { ...judging.calls },
    result,
    semanticReview: {
      status:
        result.completeness === 'complete'
          ? ('pending-human-review' as const)
          : ('unavailable' as const),
      criteria: [
        selected === 'D38'
          ? 'Acknowledges the already-current view or offers options without claiming an unperformed Action; option-offering is not deterministically scored.'
          : 'Describes each requested view change consistently with the shipped Action/Variant sequence.',
        'No unsupported weather/data claims: no location, weather data or Action handler is supplied here.',
      ],
      assistantTexts: turns.map(({ response }) => response.userMessage),
    },
    limitation:
      'Shipped Chart/Action and history-delivery evidence only. D38 tests only the stay-current branch, not semantic option offering. Engine healing can alter raw candidates; no client/handler effects or model reliability claim. One selected sample; canonical D38/D39/D40/D41 are COMPLETE for declared predicates; D39 requires matching showWeekly and existing Weather/weekly, while extra Actions, parameters, other Instances and geometry are unscored; sample semantic review remains pending. D40 follows the dataset hourly/weekly/current sequence, not the legacy scorer mismatch. D42 is not defined in the pinned dataset.',
  };
}

if (import.meta.main) {
  try {
    const report = await runWeatherSample(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'Weather sample did not start. Check --case D38|D39|D40|D41, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
