import type { ActionName, InstanceId } from '@maelstrom-co/protocol';
import { MAX_ACTION_PARAMS_JSON_UTF8_BYTES } from '@maelstrom-co/protocol';

import type { Logger } from '../../logger.js';
import {
  MAX_ACTION_PARAM_DEPTH,
  MAX_ACTION_PARAM_KEYS,
  MAX_ACTION_PARAM_TRAVERSAL_UNITS,
} from '../../model-output-limits.js';
import type { ParamsLimitKind } from './types.js';

/** Bounded parse outcome without retaining model-authored parameter content on failure. */
export type ParseParamsResult =
  | { readonly kind: 'parsed'; readonly params: Record<string, unknown> }
  | { readonly kind: 'parse_failed' }
  | { readonly kind: 'limit'; readonly limit: ParamsLimitKind };

/**
 * Parses one params object after enforcing UTF-8 bytes, top-level keys, depth,
 * and deterministic value-pop work. The root consumes one unit at depth zero;
 * unit 4,096 and depth 32 are accepted.
 */
export function parseParams(
  paramsJson: string,
  action: ActionName,
  instanceId: InstanceId,
  logger: Logger,
): ParseParamsResult {
  if (
    paramsJson.length > MAX_ACTION_PARAMS_JSON_UTF8_BYTES ||
    new TextEncoder().encode(paramsJson).length >
      MAX_ACTION_PARAMS_JSON_UTF8_BYTES
  ) {
    logger.error('Action params exceeded the JSON byte limit, skipping action');
    return { kind: 'limit', limit: 'params_json_bytes' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    logger.error(
      `Failed to parse paramsJson for action "${action}" on "${instanceId}", skipping action`,
    );
    return { kind: 'parse_failed' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const parsedType = Array.isArray(parsed)
      ? 'array'
      : parsed === null
        ? 'null'
        : typeof parsed;
    logger.error(
      `paramsJson for action "${action}" on "${instanceId}" is not a JSON object, skipping action`,
      undefined,
      { parsedType },
    );
    return { kind: 'parse_failed' };
  }

  const params = parsed as Record<string, unknown>;
  if (Object.keys(params).length > MAX_ACTION_PARAM_KEYS) {
    logger.error(
      'Action params exceeded the top-level key limit, skipping action',
    );
    return { kind: 'limit', limit: 'top_level_keys' };
  }

  const pending: Array<{ value: unknown; depth: number }> = [
    { value: params, depth: 0 },
  ];
  let units = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    if (current.depth > MAX_ACTION_PARAM_DEPTH) {
      logger.error('Action params exceeded the depth limit, skipping action');
      return { kind: 'limit', limit: 'depth' };
    }
    units += 1;
    if (units > MAX_ACTION_PARAM_TRAVERSAL_UNITS) {
      logger.error(
        'Action params exceeded the traversal limit, skipping action',
      );
      return { kind: 'limit', limit: 'traversal_work' };
    }

    if (current.value === null || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], depth: current.depth + 1 });
      }
      continue;
    }

    const record = current.value as Record<string, unknown>;
    const keys = Object.keys(record);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      pending.push({
        value: record[keys[index] as string],
        depth: current.depth + 1,
      });
    }
  }

  return { kind: 'parsed', params };
}
