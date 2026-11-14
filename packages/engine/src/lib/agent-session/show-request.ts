import {
  type ChartRequest,
  type JsonValue,
  JsonValueSchema,
} from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import type { AgentRunToolPhaseEndedEvent } from './agent-run.js';
import type { ToolRegistry } from './tool-registry.js';

/** Most characters the JSON-serialized intent facts of one show may take. */
export const SHOW_FACTS_MAX_CHARS = 8_000;

/** What one tool phase contributes to the show it asks for. */
export interface ShowFacts {
  /** Names of the tools whose calls succeeded, in call order, repeated when a tool ran more than once. */
  readonly toolNames: readonly string[];
  /**
   * Facts the successful calls produced, each call's under the key
   * `<toolName>:<callId>` in call order. Absent when no call produced facts.
   */
  readonly intentFacts?: Readonly<Record<string, JsonValue>>;
}

/**
 * Collects what a settled tool phase contributes to a show.
 *
 * Returns `undefined` when no result succeeded, because only a phase with a
 * successful result asks for a show. A successful call whose tool declares no
 * `intentFacts` extractor still counts and is listed. An extractor that throws
 * or returns anything other than a JSON object loses that call's facts, with a
 * warning that names only the tool. When the merged facts would serialize to
 * more than {@link SHOW_FACTS_MAX_CHARS} characters, the call that crosses the
 * cap and every later call lose their facts, with one warning naming their
 * tools.
 */
export function collectShowFacts(
  phase: AgentRunToolPhaseEndedEvent,
  registry: ToolRegistry,
  logger: Logger,
): ShowFacts | undefined {
  const toolNames: string[] = [];
  const intentFacts: Record<string, JsonValue> = {};
  const overCap: string[] = [];
  let hasFacts = false;
  for (const result of phase.results) {
    if (!result.ok) continue;
    toolNames.push(result.name);
    const facts = extractFacts(result.name, result.value, registry, logger);
    if (facts === undefined) continue;
    const key = `${result.name}:${result.callId}`;
    if (
      overCap.length > 0 ||
      JSON.stringify({ ...intentFacts, [key]: facts }).length >
        SHOW_FACTS_MAX_CHARS
    ) {
      overCap.push(result.name);
      continue;
    }
    intentFacts[key] = facts;
    hasFacts = true;
  }
  if (toolNames.length === 0) return undefined;
  if (overCap.length > 0) {
    logger.warn('Dropped intent facts past the show character cap', {
      toolNames: overCap,
      maxChars: SHOW_FACTS_MAX_CHARS,
    });
  }
  return hasFacts ? { toolNames, intentFacts } : { toolNames };
}

/**
 * Builds the Planner request for one show from a Chart snapshot. Any
 * client-sent `skipReply` and `intentFacts` are replaced: the request sets
 * `skipReply: true`, carries `intentFacts` only when given, and states
 * `intent` as its only `user_intent` update reason.
 */
export function buildShowRequest(
  chart: ChartRequest,
  intent: string,
  intentFacts?: Readonly<Record<string, JsonValue>>,
): ChartRequest {
  const { intentFacts: _clientFacts, ...snapshot } = chart;
  return {
    ...userIntentRequest(snapshot, intent),
    skipReply: true,
    ...(intentFacts === undefined ? {} : { intentFacts }),
  };
}

/**
 * Copies a Chart snapshot into a request that plans for one user intent:
 * any client-sent `skipReply` is removed and `intent` becomes the only
 * `user_intent` update reason.
 */
export function userIntentRequest(
  chart: ChartRequest,
  intent: string,
): ChartRequest {
  const { skipReply: _skipReply, ...snapshot } = chart;
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      updateReasons: [{ type: 'user_intent', intent }],
    },
  };
}

function extractFacts(
  toolName: string,
  output: unknown,
  registry: ToolRegistry,
  logger: Logger,
): Readonly<Record<string, JsonValue>> | undefined {
  const extract = registry.get(toolName)?.intentFacts;
  if (extract === undefined) return undefined;
  let json: Readonly<Record<string, JsonValue>> | undefined;
  try {
    json = toJsonObject(extract(output));
  } catch {
    logger.warn('Server tool intentFacts threw', { toolName });
    return undefined;
  }
  if (json === undefined) {
    logger.warn('Server tool intentFacts returned no JSON object', {
      toolName,
    });
    return undefined;
  }
  return Object.keys(json).length === 0 ? undefined : json;
}

function toJsonObject(
  facts: unknown,
): Readonly<Record<string, JsonValue>> | undefined {
  if (!isPlainObject(facts)) return undefined;
  const parsed = JsonValueSchema.safeParse(facts);
  if (!parsed.success) return undefined;
  // A self-referencing object passes the schema but cannot be serialized, so
  // serialize here, where a throw drops only this call's facts.
  JSON.stringify(parsed.data);
  return parsed.data as Readonly<Record<string, JsonValue>>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
