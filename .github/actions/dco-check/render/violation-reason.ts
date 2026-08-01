import type { Violation } from '../policy/violation.ts';
import { CELL_LIMIT } from './cell-limit.ts';
import { code } from './code.ts';
import { truncate } from './truncate.ts';

export function violationReason(verdict: Violation): string {
  if (verdict.reason === 'missing-sign-off') {
    return 'no Signed-off-by trailer';
  }
  return `sign-off email matches neither author nor committer${signedOffSuffix(verdict.signedOffAs)}`;
}

// A commit may carry any number of `Signed-off-by` trailers, so this is the one
// cell a single row can blow the comment's whole size budget on.
function signedOffSuffix(addresses: string[]): string {
  if (addresses.length === 0) {
    return '';
  }
  const named = addresses
    .slice(0, ADDRESS_LIMIT)
    .map((address) => code(truncate(address, CELL_LIMIT)));
  const omitted = addresses.length - named.length;
  const rest = omitted === 0 ? '' : `, and ${omitted} more`;
  return ` (signed off as ${named.join(', ')}${rest})`;
}

const ADDRESS_LIMIT = 3;
