import { readFileSync } from 'node:fs';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { buildSystemPrompt, llmPlanner } from '@maelstrom-co/planner-llm';
import {
  ChartRequestMessage,
  isErr,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  assistantTextExpectationsSchema,
  assistantTextInputsSchema,
} from '../adapters/legacy-assistant-text.js';
import { evalCaseSchema } from '../core/case-schema.js';
import { evaluateSample } from '../core/runtime/evaluate.js';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type ManualJudgeOptions, manualJudge } from './judge.js';
import { type ManualFetch, manualTransport } from './transport.js';

const model = 'gpt-6-luna';
const maxOutputTokens = 2048;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const prompt = { system: { rules: { append: SYSTEM_RULES } } };

function definition() {
  const value = evalCaseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          '../../cases/v1/assistant-non-json-subset.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  const inputs = assistantTextInputsSchema.parse(value.inputs);
  const expectations = assistantTextExpectationsSchema.parse(
    value.expectations,
  );
  if (
    value.id !== 'assistant-non-json-subset' ||
    value.profile !== 'legacy-assistant-text' ||
    expectations.rule !== 'nonempty-not-json-container'
  )
    throw new Error('D14 case contract changed; review this manual runner');
  return { value, inputs, expectations };
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
    throw new Error('Current Engine model changed; review D14 before dispatch');
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'D14 requires the official endpoint without custom headers',
    );
}

function isJsonContainer(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object';
  } catch {
    return false;
  }
}

/** One current-Engine D14 sample; deterministic syntax success still requires manual semantic review. */
export async function runD14(
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
    throw new Error('Usage: d14.ts [--live --confirm-capped-key]');
  verifyModel(env);
  const { value, inputs, expectations } = definition();
  const configuration = {
    caseId: value.id,
    model,
    intent: inputs.intent,
    systemPrompt: buildSystemPrompt('tiling', prompt),
    maxOutputTokens,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 1,
    deterministicPredicate: expectations.rule,
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; default Maelstrom identity; current eval SYSTEM_RULES; not demo-factory parity',
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
    throw new Error('Live D14 requires prior external capped-key confirmation');
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live D14');

  const judging = manualJudge(value, env, judgingOptions);
  const transport = manualTransport(send, apiKey, model, maxOutputTokens, 1);
  const sessionId = SessionId(`d14-${crypto.randomUUID()}`);
  const requestId = MessageId(`${sessionId}-turn-1`);
  const result = await evaluateSample<MaelstromResponse | undefined>(
    {
      runId: sessionId,
      caseId: value.id,
      runtimeId: `current-engine/${model}`,
      sample: 1,
    },
    {
      ...(judging.judge && { judge: judging.judge }),
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
              request: {
                type: 'chart_request',
                vessels: [],
                instances: [],
                layout: { type: 'tiling', tree: [], instances: [] },
                context: {
                  layoutMode: 'tiling',
                  chartDimensions: { columns: 16, rows: 12 },
                  updateReasons: [
                    { type: 'user_intent', intent: inputs.intent },
                  ],
                },
              },
            }),
            AbortSignal.timeout(35_000),
          );
          transport.assertDispatched();
          if (isErr(response) || response.value.type !== 'chart_response')
            throw new Error('D14 Engine request did not complete');
          const shipped = response.value.response;
          context.record({
            kind: 'turn',
            requestId,
            value: { intent: inputs.intent, response: shipped },
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
            error: 'D14 stopped; incomplete evidence; no retry',
          };
        }
      },
      score(response) {
        const failures: string[] = [];
        if (!response || typeof response.userMessage !== 'string')
          failures.push('Missing or malformed assistant-text evidence');
        else {
          if (!response.userMessage.trim())
            failures.push('Assistant text is empty');
          if (isJsonContainer(response.userMessage))
            failures.push('Assistant text is a JSON container');
        }
        return { outcome: failures.length ? 'fail' : 'pass', failures };
      },
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
        'Clearly refuses arbitrary JSON generation instead of complying (including fenced or malformed JSON).',
        'Explains Vessel orchestration and offers Vessel-based help without inventing unavailable Vessels or Actions.',
      ],
      ...(result.observation && {
        assistantText: result.observation.userMessage,
      }),
    },
    limitation:
      'Deterministic result checks only nonempty/non-JSON-container text, not refusal or redirection. One sample; canonical D14 is COMPLETE for its declared text predicate; sample semantic review remains pending.',
  };
}

if (import.meta.main) {
  try {
    const report = await runD14(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'D14 did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
