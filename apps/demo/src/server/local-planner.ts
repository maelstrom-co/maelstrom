/**
 * Chooses the local dev server's planner from the environment:
 * `MAELSTROM_PLANNER=llm` (the default), `jev` (the frozen Jev POC),
 * `jev-composed-pairs` (the experimental Jev planner that composes the
 * layout from pair answers), or `decisions` and `decisions-composed-pairs`
 * (the same two planners answered by OpenAI Decisions). The hosted Worker
 * never reads this; it always plans with the LLM.
 */
import type { Engine } from '@maelstrom-co/engine';
import {
  createDecisionsPlaygroundEngine,
  createJevPlaygroundEngine,
  createPlaygroundEngine,
  type DecisionsPlannerName,
  type JevPlannerName,
} from './engine-config';
import { createDemoOpenaiChat, ENGINE_MODEL } from './engine-model';
import { createRedactingLogger, redactSecrets } from './redact';

export type LocalPlannerName = 'llm' | JevPlannerName | DecisionsPlannerName;

const JEV_PLANNERS: readonly JevPlannerName[] = ['jev', 'jev-composed-pairs'];
// The Decisions planners' default model; the package's root entry exports no model constant.
const DECISIONS_MODEL = 'gpt-6-luna';

const DECISIONS_PLANNERS: readonly DecisionsPlannerName[] = [
  'decisions',
  'decisions-composed-pairs',
];

export interface SharedEngineResult {
  readonly engine: Engine | null;
  readonly initError: string | null;
}

export interface LocalEngine extends SharedEngineResult {
  readonly planner: LocalPlannerName;
  /**
   * Whether new sockets start with the handshake already satisfied: true
   * when the server owns the keys, false when each visitor must send a
   * browser key in `playground.hello` first.
   */
  readonly helloReceived: boolean;
  /** Every server-held secret, for redacting outbound frames. */
  readonly secrets: readonly string[];
}

/**
 * Builds the shared local-dev engine, redacting `secrets` out of both the
 * returned init-error string and the console warning if construction fails.
 *
 * This is defence in depth, not a demonstrated leak: the try below wraps
 * only synchronous construction (`new OpenAI(config)` plus zod config
 * validation), and neither one echoes the key back into its error message
 * today. The realistic 401 key-echo happens later, inside `engine.handle()`,
 * which returns an `Err` rather than throwing here; see dispatch.ts.
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

/**
 * Builds the engine every local socket shares. `llm` keeps today's
 * behaviour: a server `OPENAI_API_KEY` builds a shared engine, otherwise each
 * visitor supplies a browser key. `jev` and `jev-composed-pairs` need
 * `TYPESAFE_API_KEY`, a pinned `JEV_MODEL` and a server `OPENAI_API_KEY`;
 * `decisions` and `decisions-composed-pairs` need only the server
 * `OPENAI_API_KEY`. None of them has a browser-key flow.
 *
 * @throws {Error} On an unknown `MAELSTROM_PLANNER`, a missing staged
 *   planner setting, or a staged engine that fails to build. Secrets are
 *   redacted.
 */
export function buildLocalEngine(
  env: Readonly<Record<string, string | undefined>>,
): LocalEngine {
  const planner = env.MAELSTROM_PLANNER?.trim() || 'llm';
  const openaiKey = env.OPENAI_API_KEY?.trim() ?? '';
  const typesafeKey = env.TYPESAFE_API_KEY?.trim() ?? '';
  const secrets = [openaiKey, typesafeKey].filter((key) => key.length > 0);
  const logger = createRedactingLogger(secrets);

  if (planner === 'llm') {
    const shared = openaiKey
      ? buildSharedEngine(openaiKey, secrets)
      : { engine: null, initError: 'No server OpenAI key configured.' };
    logger.info('local_planner.ready', {
      planner: 'llm',
      llmModel: ENGINE_MODEL,
      status: openaiKey
        ? shared.engine
          ? 'ready'
          : 'unavailable'
        : 'awaiting_browser_key',
    });
    return {
      ...shared,
      planner: 'llm',
      helloReceived: openaiKey.length > 0,
      secrets,
    };
  }
  if (isDecisionsPlanner(planner))
    return buildDecisionsEngine(planner, openaiKey, env, secrets, logger);
  if (!isJevPlanner(planner))
    throw new Error(
      `MAELSTROM_PLANNER must be llm, jev, jev-composed-pairs, decisions or decisions-composed-pairs, got "${redactSecrets(planner, secrets)}".`,
    );

  if (!typesafeKey)
    throw new Error(`MAELSTROM_PLANNER=${planner} requires TYPESAFE_API_KEY.`);
  const model = env.JEV_MODEL?.trim();
  if (!model)
    throw new Error(
      `MAELSTROM_PLANNER=${planner} requires a pinned JEV_MODEL, for example jev-1.13.0.`,
    );
  if (!openaiKey)
    throw new Error(
      `MAELSTROM_PLANNER=${planner} requires a server OPENAI_API_KEY for the reply and the fallback.`,
    );

  const logReplies = env.JEV_LOG_REPLIES?.trim() === '1';
  let engine: Engine;
  try {
    engine = createJevPlaygroundEngine({
      planner,
      adapter: createDemoOpenaiChat(openaiKey),
      logger,
      typesafe: {
        apiKey: typesafeKey,
        model,
        logReplies,
      },
    });
  } catch (error) {
    throw new Error(
      redactSecrets(
        error instanceof Error ? error.message : String(error),
        secrets,
      ),
    );
  }
  logger.info('local_planner.ready', {
    planner,
    jevModel: model,
    llmModel: ENGINE_MODEL,
    logReplies,
    status: 'ready',
  });
  return {
    engine,
    initError: null,
    planner,
    helloReceived: true,
    secrets,
  };
}

function isJevPlanner(planner: string): planner is JevPlannerName {
  return (JEV_PLANNERS as readonly string[]).includes(planner);
}

function isDecisionsPlanner(planner: string): planner is DecisionsPlannerName {
  return (DECISIONS_PLANNERS as readonly string[]).includes(planner);
}

function buildDecisionsEngine(
  planner: DecisionsPlannerName,
  openaiKey: string,
  env: Readonly<Record<string, string | undefined>>,
  secrets: readonly string[],
  logger: ReturnType<typeof createRedactingLogger>,
): LocalEngine {
  if (!openaiKey)
    throw new Error(
      `MAELSTROM_PLANNER=${planner} requires a server OPENAI_API_KEY for Decisions, the reply and the fallback.`,
    );
  const logReplies = env.DECISIONS_LOG_REPLIES?.trim() === '1';
  let engine: Engine;
  try {
    engine = createDecisionsPlaygroundEngine({
      planner,
      adapter: createDemoOpenaiChat(openaiKey),
      logger,
      decisions: { apiKey: openaiKey, logReplies },
    });
  } catch (error) {
    throw new Error(
      redactSecrets(
        error instanceof Error ? error.message : String(error),
        secrets,
      ),
    );
  }
  logger.info('local_planner.ready', {
    planner,
    decisionsModel: DECISIONS_MODEL,
    llmModel: ENGINE_MODEL,
    logReplies,
    status: 'ready',
  });
  return {
    engine,
    initError: null,
    planner,
    helloReceived: true,
    secrets,
  };
}
