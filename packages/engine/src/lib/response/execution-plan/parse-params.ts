import type { ActionName, InstanceId } from '@maelstrom-co/protocol';

import type { Logger } from '../../logger.js';

export function parseParams(
  paramsJson: string,
  action: ActionName,
  instanceId: InstanceId,
  logger: Logger,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    logger.error(
      `Failed to parse paramsJson for action "${action}" on "${instanceId}", skipping action`,
    );
    return undefined;
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
    return undefined;
  }

  return parsed as Record<string, unknown>;
}
