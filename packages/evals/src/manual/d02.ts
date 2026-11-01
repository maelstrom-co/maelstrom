import { readFileSync } from 'node:fs';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { buildSystemPrompt, llmPlanner } from '@maelstrom-co/planner-llm';
import {
  type ChartRequest,
  ChartRequestMessage,
  isErr,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  assistantIdentityExpectationsSchema,
  assistantIdentityInputsSchema,
} from '../adapters/legacy-assistant-identity.js';
import { evalCaseSchema } from '../core/case-schema.js';
import { evaluateSample } from '../core/runtime/evaluate.js';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type ManualJudgeOptions, manualJudge } from './judge.js';
import { type ManualFetch, manualTransport } from './transport.js';

const model = 'gpt-6-luna';
const maxOutputTokens = 2048;
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const prompt = {
  vars: { assistantName: 'MAR' },
  system: {
    identity:
      'You are MAR, a health assistant that helps patients explore lab results and related charts. Speak as MAR consistently, and do not describe yourself as Maelstrom. Keep your explanations grounded in what is actually visible or configured in the chart.',
    rules: { append: SYSTEM_RULES },
  },
};

function definition() {
  const value = evalCaseSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          '../../cases/v1/assistant-identity-subset.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
  const inputs = assistantIdentityInputsSchema.parse(value.inputs);
  const expectations = assistantIdentityExpectationsSchema.parse(
    value.expectations,
  );
  if (
    value.id !== 'assistant-identity-subset' ||
    value.profile !== 'legacy-assistant-identity' ||
    expectations.requiredIdentity !== 'MAR' ||
    expectations.forbiddenIdentity !== 'Maelstrom'
  )
    throw new Error('D02 case contract changed; review this manual runner');
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
    throw new Error('Current Engine model changed; review D02 before dispatch');
  if (env.OPENAI_BASE_URL || env.OPENAI_CUSTOM_HEADERS)
    throw new Error(
      'D02 requires the official endpoint without custom headers',
    );
}

/** Manual D02 execution; no arguments means no adapter, credentials, or network access. */
export async function runD02(
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
    throw new Error('Usage: d02.ts [--live --confirm-capped-key]');
  verifyModel(env);
  const { value, inputs, expectations } = definition();
  const configuration = {
    caseId: value.id,
    model,
    identity: expectations.requiredIdentity,
    prompts: inputs.turns.map((turn) => turn.intent),
    systemPrompt: buildSystemPrompt('tiling', prompt),
    maxOutputTokens,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 3,
    budget: 'external capped key; not verified by this script',
    provenance:
      'current Engine + llmPlanner; current eval SYSTEM_RULES; not demo-factory parity',
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
    throw new Error('Live D02 requires prior external capped-key confirmation');
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for live D02');

  const judging = manualJudge(value, env, judgingOptions);
  const transport = manualTransport(send, apiKey, model, maxOutputTokens, 3);
  const sessionId = SessionId(`d02-${crypto.randomUUID()}`);
  const turns: Array<{
    index: number;
    requestId: string;
    intent: string;
    response: MaelstromResponse;
  }> = [];
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
        let layout: ChartRequest['layout'] = {
          type: 'tiling',
          tree: [],
          instances: [],
        };
        let instances: ChartRequest['instances'] = [];
        for (const [index, { intent }] of inputs.turns.entries()) {
          try {
            transport.beginTurn(index);
            const requestId = MessageId(`${sessionId}-turn-${index + 1}`);
            const response = await engine.handle(
              ChartRequestMessage({
                sessionId,
                id: requestId,
                request: {
                  type: 'chart_request',
                  vessels: [],
                  instances,
                  layout,
                  context: {
                    layoutMode: 'tiling',
                    chartDimensions: { columns: 16, rows: 12 },
                    updateReasons: [{ type: 'user_intent', intent }],
                  },
                },
              }),
              AbortSignal.timeout(35_000),
            );
            transport.assertDispatched();
            if (isErr(response) || response.value.type !== 'chart_response')
              throw new Error('D02 Engine request did not complete');
            const turn = {
              index,
              requestId,
              intent,
              response: response.value.response,
            };
            turns.push(turn);
            context.record({ kind: 'turn', requestId, value: turn });
            layout = turn.response.layout;
            instances = layout.type === 'tiling' ? layout.instances : [];
          } catch {
            return {
              completeness: turns.length
                ? ('partial' as const)
                : ('absent' as const),
              disposition: 'planned' as const,
              value: turns,
              error: `D02 stopped at turn ${index + 1}; incomplete evidence; no retry`,
            };
          }
        }
        return {
          completeness: 'complete' as const,
          disposition: 'planned' as const,
          value: turns,
        };
      },
      score(observed) {
        const failures: string[] = [];
        if (observed.length !== expectations.expectedTurns)
          failures.push('Expected three completed turns');
        for (const [index, turn] of observed.entries()) {
          const { response } = turn;
          const text = response.userMessage.toLowerCase();
          if (
            turn.index !== index ||
            turn.intent !== inputs.turns[index]?.intent
          )
            failures.push(`Changed prompt or order at turn ${index + 1}`);
          if (
            !text.trim() ||
            !text.includes(expectations.requiredIdentity.toLowerCase()) ||
            text.includes(expectations.forbiddenIdentity.toLowerCase())
          )
            failures.push(`Identity predicate failed at turn ${index + 1}`);
          if (
            response.executionPlan.length !== 0 ||
            response.layout.type !== 'tiling' ||
            response.layout.instances.length !== 0
          )
            failures.push(`Empty Chart predicate failed at turn ${index + 1}`);
        }
        return {
          outcome: failures.length ? ('fail' as const) : ('pass' as const),
          failures,
        };
      },
    },
  );
  return {
    mode: 'live' as const,
    configuration,
    generationDispatches: transport.count(),
    judgeCalls: { ...judging.calls },
    result,
    limitation:
      'One sample and lexical D02 predicates, not universal identity reliability or full migration acceptance.',
  };
}

if (import.meta.main) {
  try {
    const report = await runD02(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (report.mode === 'live' && report.result.evaluation !== 'pass')
      process.exitCode = 1;
  } catch {
    // Do not emit raw SDK, environment, or parse errors to the terminal.
    console.error(
      'D02 did not start. Check arguments, model and capped-key prerequisites in src/manual/README.md.',
    );
    process.exitCode = 1;
  }
}
