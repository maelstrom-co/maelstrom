import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { buildSystemPrompt, llmPlanner } from '@maelstrom-co/planner-llm';
import {
  type ChartRequest,
  ChartRequestMessage,
  isErr,
  type MaelstromResponse,
  MessageId,
  SessionId,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import { noDualTargetPlanInputsSchema } from '../adapters/legacy-no-dual-target-plan.js';
import { evalCaseSchema } from '../core/case-schema.js';
import { evaluateSample, type Verdict } from '../core/runtime/evaluate.js';
import { request } from '../core/scenarios.js';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type ManualFetch, manualTransport } from './transport.js';

const model = 'gpt-6-luna';
const maxOutputTokens = 2048;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const prompt = { system: { rules: { append: SYSTEM_RULES } } };

function definition() {
  const value = evalCaseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('../../cases/v1/no-dual-target-plan.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const inputs = noDualTargetPlanInputsSchema.parse(value.inputs);
  if (
    value.id !== 'no-dual-target-plan' ||
    value.profile !== 'legacy-no-dual-target-plan' ||
    inputs.intent !== 'Switch to the weekly view'
  )
    throw new Error('D17 case contract changed; review this manual runner');
  return { value, inputs };
}

/** Loads the two fixed current demo catalogs, not the legacy script or eval catalog snapshot. */
export async function d17Request(): Promise<ChartRequest> {
  // Fixed runtime URLs keep this manual Bun tool outside the demo's TypeScript build graph.
  const weather: { weatherVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const calendar: { calendarVessel?: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/calendar.vessel.def.ts',
      import.meta.url,
    ).href
  );
  return request(definition().inputs.intent, {
    vessels: [
      VesselSchema.parse(weather.weatherVessel),
      VesselSchema.parse(calendar.calendarVessel),
    ],
    instances: ['weather', 'calendar'],
    variants: { weather: 'current', calendar: 'month' },
    tree: ['V', 'ID:weather-main', 'ID:calendar-main'],
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
    throw new Error('Current Engine model changed; review D17 before dispatch');
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'D17 requires the official endpoint without custom headers',
    );
}

/** Exact shipped-state checks plus a lexical question signal; semantic clarification still needs review. */
export function scoreD17Response(
  response: MaelstromResponse | undefined,
  initial: ChartRequest,
): Verdict {
  if (!response)
    return { outcome: 'fail', failures: ['Missing complete Engine response'] };
  const failures: string[] = [];
  const questions = response.userMessage.match(/[^.!?\n]+\?/g) ?? [];
  if (
    !questions.some(
      (question) =>
        /\bweather\b/i.test(question) &&
        /\bcalendar\b/i.test(question) &&
        /\b(which|whether|or)\b/i.test(question),
    )
  )
    failures.push(
      'Clarification signal missing: ask Weather or Calendar in one question',
    );
  if (response.executionPlan.length !== 0)
    failures.push('Execution Plan must be empty');
  if (!isDeepStrictEqual(response.layout, initial.layout))
    failures.push('Chart layout changed');
  if (
    response.layout.type !== 'tiling' ||
    !isDeepStrictEqual(response.layout.instances, initial.instances)
  )
    failures.push('Chart Instance snapshots changed');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** One current-Engine D17 sample; no-op checks are independent of the unmodified planner prompt. */
export async function runD17(
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
  send: ManualFetch = globalThis.fetch,
) {
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !['--live', '--confirm-capped-key'].includes(arg)) ||
    (args.includes('--confirm-capped-key') && !args.includes('--live'))
  )
    throw new Error('Usage: d17.ts [--live --confirm-capped-key]');
  verifyModel(env);
  const { value, inputs } = definition();
  const initial = await d17Request();
  const configuration = {
    caseId: value.id,
    model,
    intent: inputs.intent,
    initialRequest: structuredClone(initial),
    systemPrompt: buildSystemPrompt('tiling', prompt),
    maxOutputTokens,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 1,
    deterministicPredicate:
      'exact-shipped-chart-preservation + empty-plan + lexical-choice-question',
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; default Maelstrom identity; current eval SYSTEM_RULES; not demo-factory parity',
    source: value.lineage,
  };
  if (!args.includes('--live'))
    return { mode: 'dry-run' as const, configuration, generationDispatches: 0 };
  if (!args.includes('--confirm-capped-key'))
    throw new Error('Live D17 requires prior external capped-key confirmation');
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live D17');

  const transport = manualTransport(send, apiKey, model, maxOutputTokens, 1);
  const sessionId = SessionId(`d17-${crypto.randomUUID()}`);
  const requestId = MessageId(`${sessionId}-turn-1`);
  const result = await evaluateSample<MaelstromResponse | undefined>(
    {
      runId: sessionId,
      caseId: value.id,
      runtimeId: `current-engine/${model}`,
      sample: 1,
    },
    {
      surface: 'planner-response',
      provenance: configuration.provenance,
      async execute(context) {
        try {
          const adapter = createOpenaiChat(model, apiKey, {
            baseURL: 'https://api.openai.com/v1',
            maxRetries: 0,
            timeout: 30_000,
            logLevel: 'off',
            logger: silent,
            fetch: transport.fetch,
          });
          const engine = createEngine({
            planner: llmPlanner({
              adapter,
              prompt,
              modelOptions: {
                max_output_tokens: maxOutputTokens,
                service_tier: 'default',
                store: false,
                include: [],
              },
            }),
            retry: false,
            logger: silent,
            history: { store: createInMemoryStore(), maxEntries: 20 },
          });
          transport.beginTurn(0);
          const response = await engine.handle(
            ChartRequestMessage({
              sessionId,
              id: requestId,
              request: structuredClone(initial),
            }),
            AbortSignal.timeout(35_000),
          );
          transport.assertDispatched();
          if (isErr(response) || response.value.type !== 'chart_response')
            throw new Error('D17 Engine request did not complete');
          const shipped = response.value.response;
          context.record({
            kind: 'turn',
            requestId,
            value: { request: initial, response: shipped },
          });
          return {
            completeness: 'complete',
            disposition: 'planned',
            value: shipped,
          };
        } catch {
          return {
            completeness: 'absent',
            disposition: 'planned',
            value: undefined,
            error: 'D17 stopped; incomplete evidence; no retry',
          };
        }
      },
      score: (response) => scoreD17Response(response, initial),
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
        'Genuinely asks whether Weather or Calendar is intended, without claiming a change has already happened.',
        'Leaves the full shipped Chart layout and Instance snapshots unchanged with no Actions.',
      ],
      ...(result.observation && {
        assistantText: result.observation.userMessage,
      }),
    },
    limitation:
      'Exact shipped Chart/no-Action checks plus a lexical question signal, not semantic certification or client-effect evidence. Engine healing may change the raw candidate. One sample; canonical D17 is COMPLETE for its declared target-exclusion predicate; sample semantic review remains pending.',
  };
}

if (import.meta.main) {
  try {
    const report = await runD17(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'D17 did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
