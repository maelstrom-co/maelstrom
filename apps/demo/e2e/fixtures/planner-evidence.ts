import {
  createDevtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';

const tools = createDevtools({ initialIsOpen: true });
const longHistory = new URL(location.href).searchParams.has('long-history');
const event = (
  requestId: string,
  id: string,
  kind: string,
  metadata: Record<string, unknown> = {},
  content?: unknown,
) => ({
  id,
  sessionId: 'planner-fixture-session',
  requestId,
  kind,
  at: 100,
  metadata: { clientId: 'planner-fixture-app', ...metadata },
  content,
});
const events = ['a', 'b'].flatMap((requestId) => [
  event(requestId, `${requestId}-start`, 'client.request.started'),
  event(requestId, `${requestId}-planning`, 'engine.planner.started'),
  event(requestId, `${requestId}-attempt-0`, 'engine.planner.attempt', {
    'maelstrom.attempt': 0,
  }),
  event(requestId, `${requestId}-call-0`, 'engine.llm.call', {
    'gen_ai.request.model': 'example-model',
    'gen_ai.usage.input_tokens': 120,
    'gen_ai.usage.output_tokens': 0,
    'maelstrom.outcome': 'ok',
    'maelstrom.latency_ms': 430,
  }),
  event(
    requestId,
    `${requestId}-validation-0`,
    'engine.candidate.validated',
    {
      outcome: 'failed',
    },
    { diagnostics: { reason: 'An Action targeted an unavailable Instance.' } },
  ),
  event(requestId, `${requestId}-attempt-1`, 'engine.planner.attempt', {
    'maelstrom.attempt': 1,
  }),
  event(requestId, `${requestId}-call-1`, 'engine.jev.call', {
    'gen_ai.request.model': 'example-layout-model',
    'gen_ai.usage.input_tokens': '[REDACTED]',
    'gen_ai.usage.output_tokens': '[TRUNCATED]',
    'maelstrom.stage': 'layout',
    'maelstrom.outcome': 'provider_timeout',
    'maelstrom.latency_ms': 240,
  }),
  ...Array.from({ length: longHistory ? 60 : 0 }, (_, index) =>
    event(requestId, `${requestId}-extra-${index}`, 'engine.llm.call', {
      'gen_ai.request.model': `retained-model-${index}`,
      'maelstrom.outcome': 'ok',
    }),
  ),
  event(requestId, `${requestId}-validation-1`, 'engine.candidate.validated', {
    outcome: 'succeeded',
  }),
  event(requestId, `${requestId}-planned`, 'engine.planner.completed', {
    outcome: 'succeeded',
    durationMs: 770,
  }),
  event(requestId, `${requestId}-receipt`, 'client.response.received', {
    source: 'request',
    durationMs: 820,
  }),
  event(requestId, `${requestId}-applied`, 'client.response.applied', {
    actionFailures: 0,
    skippedActions: 0,
    durationMs: 7,
  }),
]);
tools.importCapture(
  JSON.stringify({
    schemaVersion: 2,
    capture: { schemaVersion: 1, events },
  }),
);
mountDevtools(tools);
