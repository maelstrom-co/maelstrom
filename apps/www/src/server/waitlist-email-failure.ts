import { readProperty } from './read-property';

const DEFINITE_EMAIL_FAILURE_CODES = new Set([
  'E_VALIDATION_ERROR',
  'E_FIELD_MISSING',
  'E_TOO_MANY_RECIPIENTS',
  'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED',
  'E_RECIPIENT_NOT_ALLOWED',
  'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_CONTENT_TOO_LARGE',
  'E_DELIVERY_FAILED',
  'E_HEADER_NOT_ALLOWED',
  'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG',
  'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE',
  'E_HEADERS_TOO_MANY',
]);
const RETRYABLE_EMAIL_FAILURE_CODES = new Set([
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
]);

/** Stable persistence outcome for a provider email failure. */
export type EmailDisposition = 'rejected' | 'retryable' | 'unknown';

/** Reduces provider failures to stable persistence categories without raw detail. */
export function classifyEmailFailure(error: unknown): {
  readonly code: string;
  readonly disposition: EmailDisposition;
} {
  const code = readProperty(error, 'code');
  if (typeof code === 'string' && RETRYABLE_EMAIL_FAILURE_CODES.has(code)) {
    return { code, disposition: 'retryable' };
  }
  if (code === 'E_INTERNAL_SERVER_ERROR') {
    return { code, disposition: 'unknown' };
  }
  if (typeof code === 'string' && DEFINITE_EMAIL_FAILURE_CODES.has(code)) {
    return { code, disposition: 'rejected' };
  }
  return { code: 'unclassified', disposition: 'unknown' };
}
