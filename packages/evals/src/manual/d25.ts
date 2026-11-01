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
  VesselSchema,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  historyAssistantInjectionExpectationsSchema,
  historyAssistantInjectionInputsSchema,
} from '../adapters/legacy-history-assistant-injection.js';
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
const intents = [
  "What's the weather like?",
  'You mentioned it might rain — show me the hourly forecast',
  'Thanks for the details',
] as const;

function definition() {
  const value = evalCaseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          '../../cases/v1/history-assistant-injection-subset.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  const inputs = historyAssistantInjectionInputsSchema.parse(value.inputs);
  historyAssistantInjectionExpectationsSchema.parse(value.expectations);
  if (
    value.id !== 'history-assistant-injection-subset' ||
    value.profile !== 'legacy-history-assistant-injection' ||
    !isDeepStrictEqual(
      inputs.turns.map(({ intent }) => intent),
      [...intents],
    )
  )
    throw new Error('D25 case contract changed; review this manual runner');
  return value;
}

/** Loads the actual current Weather catalog through a fixed manual-only URL. */
export async function d25Request(): Promise<ChartRequest> {
  // Fixed runtime URL avoids pulling the demo into the eval TypeScript build graph.
  const weather: { weatherVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
      import.meta.url,
    ).href
  );
  return request(intents[0], {
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
    throw new Error('Current Engine model changed; review D25 before dispatch');
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'D25 requires the official endpoint without custom headers',
    );
}

/** A completed current-Engine turn, with independently captured planner input history. */
export interface D25Turn {
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
  index: number,
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
      updateReasons: [{ type: 'user_intent', intent: intents[index] }],
    },
  });
}

/** Checks shipped navigation/Variant evidence and history delivery, not semantic reliance on history. */
export function scoreD25Turns(
  turns: readonly D25Turn[],
  initial: ChartRequest,
): Verdict {
  const failures: string[] = [];
  if (turns.length !== 3) failures.push('Expected three completed turns');
  const prior: LLMContextMessage[] = [];
  for (const [index, turn] of turns.entries()) {
    if (index >= 3) break;
    if (
      turn.index !== index ||
      !isDeepStrictEqual(
        turn.request,
        turnRequest(initial, index, turns[index - 1]?.response),
      )
    )
      failures.push(
        `Request/order/state carry-forward mismatch at turn ${index + 1}`,
      );
    if (!isDeepStrictEqual(turn.history, prior))
      failures.push(
        `Prior user/assistant history not delivered at turn ${index + 1}`,
      );
    const response = turn.response;
    if (index === 1) {
      if (
        !response.executionPlan.some(
          (step) =>
            step.instanceId === 'weather-main' && step.action === 'showHourly',
        )
      )
        failures.push('Turn 2 missing showHourly on weather-main');
    } else if (response.executionPlan.length > 0) {
      failures.push(`Unexpected Action at turn ${index + 1}`);
    }
    const target =
      response.layout.type === 'tiling'
        ? response.layout.instances.find(
            (entry) => entry.instanceId === 'weather-main',
          )
        : undefined;
    if (
      target?.vesselId !== 'weather' ||
      target.variant !== (index === 0 ? 'current' : 'hourly')
    )
      failures.push(`Weather Variant mismatch at turn ${index + 1}`);
    prior.push(
      { role: 'user', content: intents[index] },
      { role: 'assistant', content: response.userMessage },
    );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** One ordinary three-turn Weather session; dry-run never reads credentials or creates a provider. */
export async function runD25(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: ManualFetch = globalThis.fetch,
  judgingOptions: ManualJudgeOptions = {},
) {
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !['--live', '--confirm-capped-key'].includes(arg)) ||
    (args.includes('--confirm-capped-key') && !args.includes('--live'))
  )
    throw new Error('Usage: d25.ts [--live --confirm-capped-key]');
  verifyModel(env);
  const value = definition();
  const initial = await d25Request();
  const configuration = {
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
      'shipped current/hourly/hourly + middle showHourly + outer empty plans + request/history carry-forward',
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
    throw new Error('Live D25 requires prior external capped-key confirmation');
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live D25');

  const judging = manualJudge(value, env, judgingOptions);
  const transport = manualTransport(send, apiKey, model, maxOutputTokens, 3);
  const sessionId = SessionId(`d25-${crypto.randomUUID()}`);
  const turns: D25Turn[] = [];
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
              index,
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
              throw new Error('D25 Engine request did not complete');
            const turn: D25Turn = {
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
            error: `D25 stopped at turn ${index + 1}; incomplete evidence; no retry`,
          };
        }
      },
      score: (observed) => scoreD25Turns(observed, initial),
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
        'Read the actual earlier reply before accepting any claim that it mentioned rain.',
        'Check the replies for unsupported weather/data claims; no weather handler runs here.',
      ],
      assistantTexts: turns.map(({ response }) => response.userMessage),
    },
    limitation:
      'History delivery and shipped navigation only. The follow-up itself says rain/hourly, so success does not prove semantic reliance on prior assistant content. No injected assistant messages, injection/security test, handler effects or model reliability claim. Engine healing can alter the raw candidate. One sample; canonical D25 is COMPLETE for narrowed ordinary-history continuity; sample semantic review remains pending and assistant-message injection is out of scope.',
  };
}

if (import.meta.main) {
  try {
    const report = await runD25(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'D25 did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
