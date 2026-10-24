import {
  createEngine,
  createInMemoryStore,
  type Planner,
} from '@maelstrom-co/engine';
import {
  ChartRequestMessageSchema,
  InstanceId,
  isErr,
  ok,
  SessionIdSchema,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

const greetingId = InstanceId('greeting-main');
const planner: Planner = async ({ request }) => {
  const show =
    request.context.updateReasons.some(
      (reason) => reason.type === 'user_intent',
    ) || request.instances.length > 0;
  return ok({
    userMessage: show
      ? 'Local preview complete. No model was called.'
      : 'Ready for your first intent.',
    rationale: 'The preview uses one deterministic capability.',
    executionPlan: [],
    layout: {
      tree: show ? [tilingLeafToken(greetingId)] : [],
      instances: show
        ? [
            {
              instanceId: greetingId,
              vesselId: VesselId('greeting'),
              variant: VariantName('card'),
            },
          ]
        : [],
    },
  });
};

/** This preview binds only to loopback; deployment requires application-owned authentication and policy. */
export function createStarterServer(port = 3001) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error('Use a port from 0 to 65535');
  const engine = createEngine({
    planner,
    retry: false,
    history: { store: createInMemoryStore(), maxEntries: 16 },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    maxRequestBodySize: 65_536,
    async fetch(request) {
      const url = new URL(request.url);
      const headers = {
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
      };
      if (!['127.0.0.1', 'localhost'].includes(url.hostname))
        return new Response('Forbidden', { status: 403, headers });
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin)
        return new Response('Forbidden', { status: 403, headers });
      if (request.method === 'POST' && url.pathname === '/api/process') {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: 'Invalid JSON' },
            { status: 400, headers },
          );
        }
        const parsed = ChartRequestMessageSchema.safeParse(body);
        if (!parsed.success)
          return Response.json(
            { error: 'Invalid chart request' },
            { status: 400, headers },
          );
        const result = await engine.handle(parsed.data);
        if (isErr(result) || result.value.type !== 'chart_response')
          return Response.json(
            { error: 'The local Engine could not process this request' },
            { status: 422, headers },
          );
        return Response.json(result.value.response, { headers });
      }
      if (request.method === 'POST' && url.pathname === '/api/history') {
        try {
          const body = await request.json();
          const session = SessionIdSchema.safeParse(body?.sessionId);
          if (!session.success)
            return Response.json(
              { error: 'Invalid session' },
              { status: 400, headers },
            );
          const history = await engine.getHistory(session.data);
          return isErr(history)
            ? Response.json(
                { error: 'History unavailable' },
                { status: 422, headers },
              )
            : Response.json(history.value, { headers });
        } catch {
          return Response.json(
            { error: 'Invalid JSON' },
            { status: 400, headers },
          );
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method not allowed', { status: 405, headers });
      if (url.pathname === '/')
        return new Response(Bun.file(`${import.meta.dir}/dist/index.html`), {
          headers,
        });
      if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
        const file = Bun.file(`${import.meta.dir}/dist${url.pathname}`);
        if (await file.exists()) return new Response(file, { headers });
      }
      return new Response('Not found', { status: 404, headers });
    },
    error() {
      return Response.json(
        { error: 'Local preview request failed' },
        { status: 500 },
      );
    },
  });
}

if (import.meta.main) {
  const server = createStarterServer(Number(process.argv[2] ?? 3001));
  console.log(`Maelstrom preview: http://127.0.0.1:${server.port}`);
}
