import { isDeepStrictEqual } from 'node:util';
import {
  createEngine,
  createInMemoryStore,
  createLlmPlanner,
  type Logger,
  type Planner,
  type PlanningInput,
} from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  isTilingSplitTokenString,
  type MaelstromResponse,
  MessageId,
  parseTilingSplitToken,
  SessionId,
} from '@maelstrom-co/protocol';
import { createJevPlanner } from '../src/index.js';
import {
  type Backend,
  type Fixture,
  fixtures,
  type Script,
} from './fixtures.js';
import { type Label, labelFor } from './labels.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
export const models = {
  llm: 'offline-llm-script-v1',
  jev: 'offline-jev-script-v1',
} as const;
type Payload = {
  questions: Record<string, { criteria: Record<string, string> }>;
};
type Adapter = Parameters<typeof createLlmPlanner>[0]['adapter'];
type Audit = {
  backend: Backend;
  caseId: string;
  input?: PlanningInput;
  payload?: unknown;
};
type Observation = {
  caseId: string;
  backend: Backend;
  terminal: string;
  reason?: string;
  response?: MaelstromResponse;
  logicalCalls: number;
  transportCalls: number;
  fallbackCalls: number;
  fallbackInvocations: number;
  primaryOutcome?: string;
  transportAbortObserved: boolean;
  primaryDeferral?: { reason: string; limit?: unknown };
  persistedTurns: number;
  harnessMs: number;
  invariants: string[];
};

function recursivelyFrozen(value: unknown): boolean {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen))
  );
}

async function observe(
  fixture: Fixture,
  backend: Backend,
  audit?: (event: Audit) => void,
): Promise<Observation> {
  const controller = new AbortController();
  const observation: Observation = {
    caseId: fixture.id,
    backend,
    terminal: 'unknown',
    logicalCalls: 0,
    transportCalls: 0,
    fallbackCalls: 0,
    fallbackInvocations: 0,
    transportAbortObserved: false,
    persistedTurns: 0,
    harnessMs: 0,
    invariants: [],
  };
  let firstInput: PlanningInput | undefined;
  const pendingInvocations: Promise<unknown>[] = [];
  function monitor(real: Planner, fallback: boolean): Planner {
    return {
      ...real,
      invoke(invocation) {
        const pending = (async () => {
          if (!recursivelyFrozen(invocation.input))
            observation.invariants.push('mutable planner input');
          if (firstInput && firstInput !== invocation.input)
            observation.invariants.push('fallback changed snapshot identity');
          firstInput ??= invocation.input;
          audit?.({ backend, caseId: fixture.id, input: invocation.input });
          if (fallback) observation.fallbackInvocations++;
          const budget = invocation.context.calls;
          const result = await real.invoke({
            ...invocation,
            context: {
              ...invocation.context,
              calls: {
                get remaining() {
                  return budget.remaining;
                },
                claim(call) {
                  const claimed = budget.claim(call);
                  if (claimed.ok) {
                    observation.logicalCalls++;
                    if (fallback) observation.fallbackCalls++;
                  }
                  return claimed;
                },
              },
            },
          });
          if (!fallback)
            observation.primaryOutcome = result.ok
              ? result.value.kind
              : result.error.kind;
          if (!fallback && result.ok && result.value.kind === 'deferred') {
            observation.primaryDeferral = {
              reason: result.value.reason,
              limit: result.value.detail?.limit,
            };
          }
          return result;
        })();
        pendingInvocations.push(pending);
        return pending;
      },
    };
  }
  function transportStart(
    script: Script,
    payload: unknown,
    signal?: AbortSignal | null,
  ) {
    observation.transportCalls++;
    audit?.({ backend, caseId: fixture.id, payload });
    if (script.fault === 'provider')
      throw new Error('scripted provider failure');
    if (script.fault === 'cancel') {
      controller.abort('offline cancellation probe');
      observation.transportAbortObserved = signal?.aborted === true;
      if (!observation.transportAbortObserved)
        observation.invariants.push('transport did not receive cancellation');
      throw new DOMException('cancelled', 'AbortError');
    }
  }
  function llm(script: Script, fallback = false): Planner {
    const adapter = {
      kind: 'text',
      name: 'offline',
      model: models.llm,
      chatStream() {
        throw new Error('unexpected stream path');
      },
      async structuredOutput(
        options: Parameters<Adapter['structuredOutput']>[0],
      ) {
        transportStart(
          script,
          {
            messages: options.chatOptions.messages,
            systemPrompts: options.chatOptions.systemPrompts,
            outputSchema: options.outputSchema,
          },
          options.chatOptions.abortController?.signal ??
            options.chatOptions.request?.signal,
        );
        const data =
          script.fault === 'malformed' ? {} : structuredClone(script.llm);
        return { data, rawText: JSON.stringify(data) };
      },
    } as unknown as Adapter;
    return monitor(createLlmPlanner({ adapter, logger }), fallback);
  }
  function jev(script: Script): Planner {
    let index = 0;
    const transport = (async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Payload;
      transportStart(script, payload, init?.signal);
      if (script.fault === 'malformed') return Response.json({});
      const selections = script.jev[index++];
      if (!selections) throw new Error('unexpected scripted Jev call');
      const answers = Object.fromEntries(
        Object.entries(payload.questions).map(([id, question]) => {
          const choice = selections[id];
          if (choice === undefined)
            observation.invariants.push(`unscripted question: ${id}`);
          return [
            id,
            {
              type: 'choice',
              choice,
              confidence: 1,
              probabilities: Object.fromEntries(
                Object.keys(question.criteria).map((key) => [
                  key,
                  key === choice ? 1 : 0,
                ]),
              ),
            },
          ];
        }),
      );
      return Response.json({
        model: models.jev,
        answers,
        usage: { input_tokens: 7, output_tokens: 3 },
      });
    }) as typeof fetch;
    return monitor(
      createJevPlanner({
        apiKey: 'offline-placeholder',
        endpoint: 'https://offline.invalid/v1/systemone',
        model: models.jev,
        fetch: transport,
      }),
      false,
    );
  }
  const store = createInMemoryStore();
  const sessionId = SessionId('offline');
  await store.replace(sessionId, fixture.history);
  const engine = createEngine({
    planner: {
      primary: {
        implementation:
          backend === 'llm' ? llm(fixture.script) : jev(fixture.script),
        finalization: 'strict',
        maxRepairAttempts: 0,
      },
      ...(fixture.fallback
        ? {
            fallback: {
              implementation: llm(fixture.fallback, true),
              finalization: 'strict' as const,
              maxRepairAttempts: 0,
              on: [
                'deferred',
                'invalid_plan',
                'provider_error',
                'invalid_provider_response',
              ] as const,
            },
          }
        : {}),
      operation: { timeoutMs: null, maxProviderCalls: fixture.maxCalls ?? 3 },
    },
    history: { store },
    logger,
  });
  const start = performance.now();
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId,
      id: MessageId('evaluation-turn'),
      timestamp: 2,
      request: fixture.request,
    }),
    controller.signal,
  );
  await Promise.all(pendingInvocations);
  observation.harnessMs = performance.now() - start;
  if (result.ok && result.value.type === 'chart_response') {
    observation.terminal = 'accepted';
    observation.response = result.value.response;
  } else if (!result.ok) {
    observation.terminal = result.error._tag;
    if (result.error._tag === 'PlanningDeferredError')
      observation.reason = result.error.reason;
  }
  observation.persistedTurns =
    (await store.get(sessionId)).length - fixture.history.length;
  if (observation.persistedTurns !== (observation.response ? 1 : 0))
    observation.invariants.push('incorrect history write count');
  if (observation.transportCalls !== observation.logicalCalls)
    observation.invariants.push('transport/claim mismatch');
  if (observation.fallbackInvocations > 1)
    observation.invariants.push('fallback exceeded one invocation');
  if (firstInput && !isDeepStrictEqual(firstInput.request, fixture.request))
    observation.invariants.push('request snapshot changed');
  return observation;
}

function canonicalLayout(
  layout: Label['layout'] | MaelstromResponse['layout'],
) {
  if (layout.type === 'grid')
    return {
      type: layout.type,
      positions: [...(layout.positions ?? [])].sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    };
  return {
    type: layout.type,
    tree: layout.tree?.map((token) => {
      if (token === null || token.startsWith('ID:')) return token;
      const split = isTilingSplitTokenString(token)
        ? parseTilingSplitToken(token)
        : null;
      return split
        ? {
            axis: split.axis,
            weights: split.weights.map(
              (weight) => weight / split.weights.reduce((sum, v) => sum + v, 0),
            ),
          }
        : token;
    }),
    instances: [...(layout.instances ?? [])].sort((a, b) =>
      a.instanceId.localeCompare(b.instanceId),
    ),
  };
}

export function score(observation: Observation, label: Label) {
  const mistakes: string[] = [];
  const response = observation.response;
  if (response) {
    if (
      !isDeepStrictEqual(
        canonicalLayout(response.layout),
        canonicalLayout(label.layout),
      )
    )
      mistakes.push('layout');
    const identities = (
      actions: readonly { instanceId: string; action: string }[],
    ) => actions.map(({ instanceId, action }) => ({ instanceId, action }));
    const sameActions = isDeepStrictEqual(
      identities(response.executionPlan),
      identities(label.actions),
    );
    if (!sameActions) mistakes.push('actions');
    // Parameter errors are measured only for matching action identities and order.
    if (
      sameActions &&
      !isDeepStrictEqual(
        response.executionPlan.map((a) => ({ ...a.params })),
        label.actions.map((a) => ({ ...a.params })),
      )
    )
      mistakes.push('parameters');
  }
  const regressions = [...observation.invariants];
  if (
    observation.terminal !== label.terminal ||
    observation.reason !== label.reason
  )
    regressions.push('terminal outcome differs');
  if (!isDeepStrictEqual(mistakes, label.mistakes))
    regressions.push('semantic error classification differs');
  if (
    observation.logicalCalls !== label.calls ||
    observation.fallbackCalls !== label.fallbackCalls
  )
    regressions.push('call count differs');
  if (
    response &&
    observation.backend === 'jev' &&
    observation.fallbackCalls === 0 &&
    (response.userMessage !== undefined || response.rationale !== undefined)
  )
    regressions.push('Jev synthesized presentation text');
  return {
    ...observation,
    mistakes,
    regressions,
    planRequired: label.planRequired,
    useful: Boolean(response) && label.planRequired && mistakes.length === 0,
    unnecessaryDeferral:
      observation.terminal === 'PlanningDeferredError' &&
      observation.reason === 'uncertain' &&
      label.planRequired,
    expectedNegative:
      label.terminal !== 'accepted' || label.mistakes.length > 0,
  };
}

type Row = ReturnType<typeof score>;
function summary(rows: readonly Row[]) {
  const count = (predicate: (row: Row) => boolean) =>
    rows.filter(predicate).length;
  const times = rows.map((row) => row.harnessMs).sort((a, b) => a - b);
  const percentile = (p: number) =>
    times[Math.max(0, Math.ceil(times.length * p) - 1)] ?? 0;
  return {
    cases: rows.length,
    accepted: count((r) => r.terminal === 'accepted'),
    incorrectAcceptedLayouts: count((r) => r.mistakes.includes('layout')),
    incorrectAcceptedActions: count((r) => r.mistakes.includes('actions')),
    incorrectAcceptedParameters: count((r) =>
      r.mistakes.includes('parameters'),
    ),
    usefulCoverage: {
      correctAccepted: count((r) => r.useful),
      planRequired: count((r) => r.planRequired),
    },
    deferrals: count((r) => r.terminal === 'PlanningDeferredError'),
    unnecessaryDeferrals: count((r) => r.unnecessaryDeferral),
    capabilityDeferrals: count((r) => r.reason === 'unsupported_capability'),
    providerFailures: count((r) => r.terminal === 'ProviderError'),
    primaryProviderFailures: count(
      (r) => r.primaryOutcome === 'provider_error',
    ),
    primaryDeferrals: count((r) => r.primaryOutcome === 'deferred'),
    rejectedPrimaryCandidates: count(
      (r) =>
        r.primaryOutcome === 'candidate' &&
        (r.reason === 'invalid_plan' || r.fallbackInvocations > 0),
    ),
    malformedProviderResponses: count(
      (r) => r.terminal === 'InvalidProviderResponseError',
    ),
    candidateGaps: count(
      (r) => r.primaryDeferral?.limit === 'missing_candidates',
    ),
    compilerFinalizerFailures: count(
      (r) =>
        r.terminal === 'ValidationError' ||
        r.reason === 'invalid_plan' ||
        r.primaryDeferral?.limit === 'compiler',
    ),
    cancellations: count((r) => r.terminal === 'CancellationError'),
    budgetExhaustions: count(
      (r) => r.terminal === 'PlanningBudgetExceededError',
    ),
    fallbackOperations: count((r) => r.fallbackInvocations > 0),
    fallbackCalls: rows.reduce((sum, r) => sum + r.fallbackCalls, 0),
    logicalCalls: rows.reduce((sum, r) => sum + r.logicalCalls, 0),
    harnessTimingMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      scope:
        'in-process engine and scripted transport overhead; not provider latency',
    },
    expectedNegativeOutcomes: count((r) => r.expectedNegative),
    regressions: count((r) => r.regressions.length > 0),
  };
}

export async function evaluate(
  options: {
    fixtures?: readonly Fixture[];
    audit?: (event: Audit) => void;
  } = {},
) {
  const rows: Row[] = [];
  for (const fixture of options.fixtures ?? fixtures) {
    const inputs: Partial<Record<Backend, PlanningInput>> = {};
    for (const backend of ['llm', 'jev'] as const) {
      const observation = await observe(fixture, backend, (event) => {
        if (event.input) inputs[backend] ??= event.input;
        options.audit?.(event);
      });
      rows.push(score(observation, labelFor(fixture.id, backend)));
    }
    if (inputs.llm && inputs.jev && !isDeepStrictEqual(inputs.llm, inputs.jev))
      rows[rows.length - 1].regressions.push('backend snapshots differ');
  }
  const regressions = rows
    .filter((row) => row.regressions.length > 0)
    .map(({ caseId, backend, regressions }) => ({
      caseId,
      backend,
      regressions,
    }));
  return {
    schemaVersion: 1,
    provenance:
      'offline synthetic regression probes; scripted transports; no model accuracy evidence',
    liveCalls: 0,
    models,
    policy: {
      finalization: 'strict',
      maxRepairAttempts: 0,
      defaultMaxProviderCalls: 3,
      fallback: 'at most one conventional LLM route',
    },
    cost: {
      status: 'unknown',
      verifiedPriceInputs: null,
      providerTokens: null,
      note: 'Jev response usage is synthetic validation data. No measured token usage or verified prices.',
    },
    summaries: {
      llm: summary(rows.filter((r) => r.backend === 'llm')),
      jev: summary(rows.filter((r) => r.backend === 'jev')),
    },
    rows,
    regressions,
    exitCode: regressions.length ? 1 : 0,
  };
}
