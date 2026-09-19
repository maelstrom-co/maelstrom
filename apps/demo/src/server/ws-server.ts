/// <reference types="bun" />
/**
 * Local WebSocket server with a shared server-owned LLM or Jev planner.
 * The default LLM profile accepts browser keys when no server key is configured.
 *
 * Speaks the same handleEnvelope/encodeEnvelope loop from @maelstrom-co/engine
 * and @maelstrom-co/protocol as the hosted transport (`src/worker/session-do.ts`),
 * via the shared dispatchFrame core in `./dispatch`.
 */
import { HEARTBEAT_PONG_FRAME } from '@maelstrom-co/connectors';
import {
  createEngine,
  createInMemoryStore,
  createLlmPlanner,
  type Engine,
} from '@maelstrom-co/engine';
import { createJevPlanner } from '@maelstrom-co/engine-jev';
import { dispatchFrame } from './dispatch';
import { createPlaygroundEngine, SYSTEM_RULES } from './engine-config';
import { createDemoOpenaiChat, ENGINE_MODEL } from './engine-model';
import { createRedactingLogger, redactSecrets } from './redact';

const PORT = Number(process.env.WS_PORT ?? 3001);

// RFC 6455 caps a close reason at 123 UTF-8 bytes. Bun does not throw on a
// longer one -- it silently truncates by raw byte count, with no regard for
// character boundaries. A cut landing mid-multibyte-character produces
// invalid UTF-8, and Bun then reports close code 1003 ("invalid UTF8") to
// the client instead of the code this call site actually passed. Close
// codes are load-bearing here (WebSocketConnector branches reconnect
// behavior on them), so a truncation bug silently rewrites 1011 into 1003.
export function truncateCloseReason(reason: string, maxBytes = 123): string {
  const encoded = new TextEncoder().encode(reason);
  if (encoded.length <= maxBytes) return reason;

  // Slicing on UTF-16 code units (String.prototype.slice) has no idea
  // where UTF-8 character boundaries fall, so it is exactly the unsafe
  // approach this guards against. Instead: cut the encoded bytes at
  // maxBytes and back off one byte at a time until a fatal decoder accepts
  // the result -- that is the nearest valid character boundary at or
  // before the cap.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = maxBytes; end > 0; end--) {
    try {
      return decoder.decode(encoded.subarray(0, end));
    } catch {
      // Landed mid-character; back off and retry.
    }
  }
  return '';
}

export interface SharedEngineResult {
  readonly engine: Engine | null;
  readonly initError: string | null;
}

/**
 * Builds the shared local-dev engine, redacting `apiKey` out of both the
 * returned init-error string and the console warning if construction fails.
 *
 * This is defence in depth, not a demonstrated leak: the try below wraps
 * only synchronous construction (`new OpenAI(config)` plus zod config
 * validation), and neither one echoes the key back into its error message
 * today. The realistic 401 key-echo happens later, inside `engine.handle()`,
 * which returns an `Err` rather than throwing here — see dispatch.ts.
 * Redacting anyway means a future construction-time failure that DOES carry
 * the key can't reach this log line or the `engine.error` reply it seeds.
 */
export function buildSharedEngine(
  apiKey: string,
  secrets: readonly string[] = [apiKey],
): SharedEngineResult {
  try {
    // Same redacting logger as hosted: OpenAI 401s can echo the key into
    // provider errors, and the Engine logs those via logger.error before any
    // outbound wire scrub runs. Local holds a long-lived OPENAI_API_KEY.
    return {
      engine: createPlaygroundEngine({
        adapter: createDemoOpenaiChat(apiKey),
        logger: createRedactingLogger(secrets),
      }),
      initError: null,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const initError = redactSecrets(rawMessage, secrets);
    console.warn(
      `[demo ws] engine unavailable: ${initError}\n` +
        '  Check the configured or browser-supplied OpenAI key. The socket ' +
        'still connects, but chart requests need a valid key.',
    );
    return { engine: null, initError };
  }
}

/** Resolved local engine and credential custody for every new socket. */
export interface LocalServerConfig extends SharedEngineResult {
  /** Server-owned engines do not require a visitor handshake. */
  readonly helloReceived: boolean;
  /** All configured planning credentials, used only by server redaction. */
  readonly secrets: readonly string[];
}

/** Builds the local profile before binding a port; invalid Jev settings fail startup. */
export function buildLocalServer(
  env: Readonly<Record<string, string | undefined>>,
): LocalServerConfig {
  const planner = env.MAELSTROM_PLANNER?.trim() || 'llm';
  const fallback = env.MAELSTROM_PLANNER_FALLBACK?.trim() || 'none';
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? '';
  const typesafeKey = env.TYPESAFE_API_KEY?.trim() ?? '';
  const secrets = [openaiKey, typesafeKey].filter(Boolean);
  if (planner !== 'llm' && planner !== 'jev') {
    throw new Error('MAELSTROM_PLANNER must be llm or jev.');
  }
  if (fallback !== 'none' && fallback !== 'llm') {
    throw new Error('MAELSTROM_PLANNER_FALLBACK must be none or llm.');
  }
  if (planner === 'llm') {
    if (fallback !== 'none') {
      throw new Error(
        'MAELSTROM_PLANNER_FALLBACK requires MAELSTROM_PLANNER=jev.',
      );
    }
    const config: LocalServerConfig = {
      ...(openaiKey
        ? buildSharedEngine(openaiKey, secrets)
        : { engine: null, initError: 'No server OpenAI key configured.' }),
      helloReceived: Boolean(openaiKey),
      secrets,
    };
    createRedactingLogger(secrets).info('local_planner.ready', {
      planner: 'llm',
      model: ENGINE_MODEL,
      fallback: 'none',
      status: openaiKey
        ? config.engine
          ? 'ready'
          : 'unavailable'
        : 'awaiting_browser_key',
    });
    return config;
  }
  if (!typesafeKey) throw new Error('Local Jev requires TYPESAFE_API_KEY.');
  const model = env.JEV_MODEL?.trim();
  if (!model) throw new Error('Local Jev requires a pinned JEV_MODEL.');
  if (fallback === 'llm' && !openaiKey) {
    throw new Error('Local Jev LLM fallback requires server OPENAI_API_KEY.');
  }
  try {
    const config: LocalServerConfig = {
      engine: createEngine({
        planner: {
          primary: {
            implementation: createJevPlanner({ apiKey: typesafeKey, model }),
            finalization: 'strict',
            maxRepairAttempts: 0,
          },
          ...(fallback === 'llm'
            ? {
                fallback: {
                  implementation: createLlmPlanner({
                    adapter: createDemoOpenaiChat(openaiKey),
                    prompt: { system: { rules: { append: SYSTEM_RULES } } },
                    logger: createRedactingLogger(secrets),
                  }),
                  finalization: 'strict' as const,
                  maxRepairAttempts: 1,
                  on: ['deferred', 'invalid_plan'] as const,
                },
              }
            : {}),
          operation: {
            timeoutMs: 25_000,
            maxProviderCalls: fallback === 'llm' ? 13 : 11,
          },
        },
        history: {
          store: createInMemoryStore(),
          maxEntries: 20,
          planning: { maxChars: 40_000 },
        },
        logger: createRedactingLogger(secrets),
      }),
      initError: null,
      helloReceived: true,
      secrets,
    };
    createRedactingLogger(secrets).info('local_planner.ready', {
      planner: 'jev',
      model,
      fallback,
      ...(fallback === 'llm' && { fallbackModel: ENGINE_MODEL }),
      status: 'ready',
    });
    return config;
  } catch (error) {
    throw new Error(
      redactSecrets(
        error instanceof Error ? error.message : String(error),
        secrets,
      ),
    );
  }
}

export interface SocketData {
  helloReceived: boolean;
  browserApiKey?: string;
  browserEngine?: Engine | null;
  browserEngineInitError?: string | null;
}

export interface WebSocketHandlerDeps {
  readonly sharedEngine: Engine | null;
  readonly sharedEngineInitError: string | null;
  /** Defense in depth if a secret reaches an outbound reply. */
  readonly apiKey?: string;
  /** Additional server-owned credentials, including the primary and fallback. */
  readonly secrets?: readonly string[];
}

/**
 * Builds the Bun WebSocket handler pair. Factored out of the module-scope
 * `Bun.serve(...)` call (guarded by `import.meta.main` below) so the
 * dispatch logic is importable and unit-testable — without pulling in
 * `Bun.serve`'s own side effect of binding a real port.
 */
export function createWebSocketHandlers(
  deps: WebSocketHandlerDeps,
): Bun.WebSocketHandler<SocketData> {
  const { sharedEngine, sharedEngineInitError, apiKey, secrets = [] } = deps;

  return {
    async message(ws, raw) {
      const browserApiKey = ws.data.browserApiKey;
      const result = await dispatchFrame(raw, {
        helloReceived: ws.data.helloReceived,
        getEngine: () => sharedEngine ?? ws.data.browserEngine ?? null,
        // Bun never hibernates, so a connection here has either helloed
        // in this lifetime or never at all.
        wasHelloed: false,
        engineUnavailableReason:
          ws.data.browserEngineInitError ??
          sharedEngineInitError ??
          'engine unavailable',
      });

      switch (result.kind) {
        case 'heartbeat':
          ws.send(HEARTBEAT_PONG_FRAME);
          return;
        case 'hello': {
          const built = buildSharedEngine(result.frame.apiKey, [
            ...secrets,
            result.frame.apiKey,
          ]);
          ws.data.browserApiKey = result.frame.apiKey;
          ws.data.browserEngine = built.engine;
          ws.data.browserEngineInitError = built.initError;
          ws.data.helloReceived = true;
          return;
        }
        case 'rehello':
          // Unreachable under Bun (wasHelloed is always false above); the
          // DO transport is the only producer.
          return;
        case 'hello-declined':
          // Unreachable under Bun: a decline only ever answers a rehello,
          // which this transport never sends.
          return;
        case 'close':
          ws.close(result.code, truncateCloseReason(result.reason));
          return;
        case 'reply':
          ws.send(
            redactSecrets(result.wire, [
              ...secrets,
              ...(apiKey ? [apiKey] : []),
              ...(browserApiKey ? [browserApiKey] : []),
            ]),
          );
          return;
        case 'none':
          return;
      }
    },
  };
}

if (import.meta.main) {
  const config = buildLocalServer(process.env);
  const webSocketHandlers = createWebSocketHandlers({
    sharedEngine: config.engine,
    sharedEngineInitError: config.initError,
    secrets: config.secrets,
  });
  const server = Bun.serve<SocketData>({
    port: PORT,
    fetch(req, srv) {
      let pathname: string;
      try {
        pathname = new URL(req.url).pathname;
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
      if (pathname === '/ws') {
        return srv.upgrade(req, {
          data: { helloReceived: config.helloReceived },
        })
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 });
      }
      return new Response('Maelstrom demo engine server', { status: 200 });
    },
    websocket: webSocketHandlers,
  });

  console.log(
    `[demo ws] engine server listening on ws://localhost:${server.port}/ws`,
  );
}
