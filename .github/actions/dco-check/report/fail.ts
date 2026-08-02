import { annotateError } from './annotate-error.ts';
import { errorMessage } from './error-message.ts';

// Fail closed: a required check must never pass because the API hiccupped.
export function fail(error: unknown): number {
  annotateError(errorMessage(error));
  return 1;
}
