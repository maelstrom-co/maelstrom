/**
 * Chooses the local dev server's planner from the environment:
 * `MAELSTROM_PLANNER=llm` (the default), `jev` (the frozen Jev POC) or
 * `jev-composed-pairs` (the experimental Jev planner that composes the
 * layout from pair answers). The hosted Worker never reads this; it always
 * plans with the LLM.
 */
import type { Engine } from '@maelstrom-co/engine';
import { agentPlannerMode } from './agent-planner';
import {
  createJevPlaygroundEngine,
  createPlaygroundEngine,
  type JevPlannerName,
} from './engine-config';
import { createDemoOpenaiChat, ENGINE_MODEL } from './engine-model';
import { createRedactingLogger, redactSecrets } from './redact';

export type LocalPlannerName = 'llm' | JevPlannerName;

const JEV_PLANNERS: readonly JevPlannerName[] = ['jev', 'jev-composed-pairs'];

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
  env?: Readonly<Record<string, string | undefined>>,
): SharedEngineResult {
  try {
    // Same redacting logger as hosted: OpenAI 401s can echo the key into
    // provider errors, and the Engine logs those via logger.error before any
    // outbound wire scrub runs. Local holds a long-lived OPENAI_API_KEY.
    return {
      engine: createPlaygroundEngine({
        adapter: createDemoOpenaiChat(apiKey),
        logger: createRedactingLogger(secrets),
        ...(env === undefined ? {} : { env }),
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
 * `TYPESAFE_API_KEY`, a pinned `JEV_MODEL` and a server `OPENAI_API_KEY`,
 * and have no browser-key flow.
 *
 * @throws {Error} On an unknown `MAELSTROM_PLANNER`, a missing Jev
 *   setting, or a Jev engine that fails to build. Secrets are redacted.
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
      ? buildSharedEngine(openaiKey, secrets, env)
      : { engine: null, initError: 'No server OpenAI key configured.' };
    logger.info('local_planner.ready', {
      planner: 'llm',
      agentPlanner: agentPlannerMode(env),
      lightDecider: Boolean(
        env.TYPESAFE_API_KEY?.trim() && env.JEV_MODEL?.trim(),
      ),
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
  if (!isJevPlanner(planner))
    throw new Error(
      `MAELSTROM_PLANNER must be llm, jev or jev-composed-pairs, got "${redactSecrets(planner, secrets)}".`,
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
