import { statusLabels } from './panel-model.js';
import type { RequestOutcome } from './request-evidence.js';

export const requestOutcomeLabels = {
  ...statusLabels,
  unknown: 'Outcome unknown',
  ambiguous: 'Ambiguous evidence',
} as const;

export const requestOutcomeTones = {
  awaiting: 'neutral',
  received: 'neutral',
  applied: 'success',
  'applied-with-issues': 'warning',
  failed: 'error',
  cancelled: 'neutral',
  discarded: 'warning',
  abandoned: 'warning',
  unknown: 'neutral',
  ambiguous: 'warning',
} as const satisfies Record<
  RequestOutcome,
  'neutral' | 'success' | 'warning' | 'error'
>;

export const requestTimingLabels = {
  missing: 'Not reported',
  redacted: 'Timing redacted',
  truncated: 'Timing truncated',
  unreadable: 'Timing unreadable',
  'source-unavailable': 'Request source not confirmed',
  push: 'No request round-trip for push',
  ambiguous: 'Conflicting identity',
} as const;
