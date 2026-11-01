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
  labsStateResetSyntheticExpectationsSchema,
  labsStateResetSyntheticInputsSchema,
} from '../adapters/labs-state-reset-synthetic.js';
import {
  labsStateResetSubsetExpectationsSchema,
  labsStateResetSubsetInputsSchema,
} from '../adapters/legacy-labs-state-reset-subset.js';
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
  'Show me the list of my lab results.',
  'Go back to the trends chart.',
  "What's the trend for hemoglobin?",
] as const;
const actions = ['showList', 'showTrends', 'selectMarker'] as const;
const variants = ['list', 'trends', 'trends'] as const;

function definition() {
  const load = (id: string) =>
    evalCaseSchema.parse(
      JSON.parse(
        readFileSync(
          new URL(`../../cases/v1/${id}.json`, import.meta.url),
          'utf8',
        ),
      ),
    );
  const source = load('labs-state-reset-subset');
  const value = load('labs-state-reset-synthetic');
  const sourceInputs = labsStateResetSubsetInputsSchema.parse(source.inputs);
  const sourceExpected = labsStateResetSubsetExpectationsSchema.parse(
    source.expectations,
  );
  const inputs = labsStateResetSyntheticInputsSchema.parse(value.inputs);
  labsStateResetSyntheticExpectationsSchema.parse(value.expectations);
  const lineage = [
    {
      source: 'legacy',
      revision: 'd6ef99aacb8ebce4d707d54fee14149daeea552d',
      path: 'langfuse/maelstrom-eval-dataset.v1.json',
      taskId: 'cap-maelstrom-multiturn-state-reset',
      datasetId: 'cap-maelstrom-multiturn-state-reset',
      pointer: '/items/32',
    },
  ];
  if (
    source.id !== 'labs-state-reset-subset' ||
    source.profile !== 'legacy-labs-state-reset-subset' ||
    sourceExpected.instanceId !== 'labs-main' ||
    value.id !== 'labs-state-reset-synthetic' ||
    value.profile !== 'labs-state-reset-synthetic' ||
    !isDeepStrictEqual(
      sourceInputs.turns.map(({ intent }) => intent),
      intents.slice(0, 2),
    ) ||
    !isDeepStrictEqual(
      inputs.turns.map(({ intent }) => intent),
      [...intents],
    ) ||
    !isDeepStrictEqual(source.lineage, lineage) ||
    !isDeepStrictEqual(value.lineage, lineage)
  )
    throw new Error('D33 case contract changed; review before dispatch');
  return value;
}

async function initialRequest(intent: string): Promise<ChartRequest> {
  // Fixed runtime URL avoids pulling the demo into the eval TypeScript build graph.
  const labs: { labsVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/labs.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const vessel = VesselSchema.parse(labs.labsVessel);
  const selection = vessel.variants[VariantName('trends')]?.actions.find(
    ({ name }) => name === 'selectMarker',
  );
  const parameter = selection?.parameters?.[0];
  if (
    vessel.id !== 'labs' ||
    vessel.defaultVariant !== 'trends' ||
    vessel.variants[VariantName('trends')]?.actions.find(
      ({ name }) => name === 'showList',
    )?.transitionsTo !== 'list' ||
    vessel.variants[VariantName('list')]?.actions.find(
      ({ name }) => name === 'showTrends',
    )?.transitionsTo !== 'trends' ||
    !selection ||
    selection.transitionsTo !== undefined ||
    selection.parameters?.length !== 1 ||
    parameter?.name !== 'markerSlug' ||
    parameter.type !== 'string' ||
    parameter.required !== true ||
    !isDeepStrictEqual(parameter.enum, ['hemoglobin', 'platelets', 'glucose'])
  )
    throw new Error('Demo Labs contract changed; review D33 before dispatch');
  return request(intent, {
    vessels: [vessel],
    instances: ['labs'],
    variants: { labs: 'trends' },
    tree: ['ID:labs-main'],
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
    throw new Error('Current Engine model changed; review D33 before dispatch');
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'D33 requires the official endpoint without custom headers',
    );
}

/** A completed current-Engine turn, with independently captured planner input history. */
export interface D33Turn {
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

/** Exact shipped Chart/Action and natural-history checks, not prose or handler-effect scoring. */
export function scoreD33Turns(
  turns: readonly D33Turn[],
  initial: ChartRequest,
): Verdict {
  const failures: string[] = [];
  if (turns.length !== 3) failures.push('Expected three completed turns');
  const prior: LLMContextMessage[] = [];
  for (const [index, turn] of turns.entries()) {
    if (index >= 3) break;
    const intent = intents[index];
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
    const action = actions[index];
    const variant = variants[index];
    const plan = [
      {
        instanceId: 'labs-main',
        action,
        ...(index === 2 ? { params: { markerSlug: 'hemoglobin' } } : {}),
      },
    ];
    if (!isDeepStrictEqual(turn.response.executionPlan, plan))
      failures.push(`Execution Plan mismatch at turn ${index + 1}`);
    const incoming = turn.request.instances.find(
      ({ instanceId }) => instanceId === 'labs-main',
    );
    const vessel = turn.request.vessels.find(
      ({ id }) => id === incoming?.vesselId,
    );
    const offered =
      incoming &&
      vessel?.variants[incoming.variant]?.actions.find(
        ({ name }) => name === action,
      );
    if (
      !offered ||
      (index < 2
        ? offered.transitionsTo !== variant
        : offered.transitionsTo !== undefined || incoming?.variant !== 'trends')
    )
      failures.push(
        `Action unavailable for incoming Variant at turn ${index + 1}`,
      );
    const instances = initial.instances.map((instance) => ({
      ...instance,
      variant: VariantName(variant),
    }));
    if (
      !isDeepStrictEqual(turn.response.layout, {
        ...initial.layout,
        instances,
      }) ||
      turn.response.layout.type !== 'tiling' ||
      !isDeepStrictEqual(turn.response.layout.instances, instances)
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

/** One D33 sequence with a synthetic third turn; dry-run never reads credentials or creates a provider. */
export async function runD33(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: ManualFetch = globalThis.fetch,
) {
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !['--live', '--confirm-capped-key'].includes(arg)) ||
    (args.includes('--confirm-capped-key') && !args.includes('--live'))
  )
    throw new Error('Usage: d33.ts [--live --confirm-capped-key]');
  verifyModel(env);
  const value = definition();
  const initial = await initialRequest(intents[0]);
  const configuration = {
    sample: 'D33',
    syntheticTurnIndices: [2],
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
      'exact-pre-turn-valid-actions/marker + exact-shipped-chart/variants + request/history carry-forward',
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; actual demo no-data Labs catalog; third turn synthetic; default identity and current eval SYSTEM_RULES; not demo-factory parity',
    source: value.lineage,
  };
  if (!args.includes('--live'))
    return { mode: 'dry-run' as const, configuration, generationDispatches: 0 };
  if (!args.includes('--confirm-capped-key'))
    throw new Error('Live D33 requires prior external capped-key confirmation');
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live D33');

  const transport = manualTransport(send, apiKey, model, maxOutputTokens, 3);
  const sessionId = SessionId(`d33-${crypto.randomUUID()}`);
  const turns: D33Turn[] = [];
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
              throw new Error('D33 Engine request did not complete');
            const turn: D33Turn = {
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
            error: `D33 stopped at turn ${index + 1}; incomplete evidence; no retry`,
          };
        }
      },
      score: (observed) => scoreD33Turns(observed, initial),
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
        'Describes only the declared list/trends navigation and marker label selection.',
        'Discloses that no lab results or trend data are available; no measurements, clinical interpretation or medical advice.',
      ],
      assistantTexts: turns.map(({ response }) => response.userMessage),
    },
    limitation:
      'D33 contracts are COMPLETE for declared navigation/selection predicates; sample semantic review remains pending. Two source prompts plus one explicitly synthetic third prompt. Shipped Chart/Action and history-delivery evidence only; no client/handler execution, selection persistence, clinical trend fulfillment, semantic reliance or model reliability claim. Engine healing can alter raw candidates. No lab data is supplied.',
  };
}

if (import.meta.main) {
  try {
    const report = await runD33(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'D33 did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
