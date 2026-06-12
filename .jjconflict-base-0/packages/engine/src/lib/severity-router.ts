import type { Logger } from './logger.js';
import type { RetrySeverity } from './validation/llm-output/healed-layout.js';

import { assertNever } from './assert-never.js';

/**
 * Severity-driven log routing. `unrecoverable` deserves error-level visibility
 * (response truly cannot be rendered); `medium` is a degradation worth a
 * `warn` so default paging thresholds catch it; lower severities stay at
 * `info`. Used wherever a heal-derived severity needs an operator-visible
 * signal — heal output, retry recommendations, retry exhaustion — so a
 * single consistent routing applies across the layers.
 */
export function logAtSeverity(
  logger: Logger,
  severity: RetrySeverity,
  message: string,
  data: Record<string, unknown>,
): void {
  switch (severity) {
    case 'unrecoverable':
      logger.error(message, undefined, data);
      return;
    case 'medium':
      logger.warn(message, data);
      return;
    case 'low':
    case 'none':
      logger.info(message, data);
      return;
    default:
      assertNever(severity, 'logAtSeverity');
  }
}
