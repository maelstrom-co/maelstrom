import type { Violation } from '../policy/violation.ts';
import { code } from './code.ts';

export function violationReason(verdict: Violation): string {
  if (verdict.reason === 'missing-sign-off') {
    return 'no Signed-off-by trailer';
  }
  const suffix =
    verdict.signedOffAs.length === 0
      ? ''
      : ` (signed off as ${verdict.signedOffAs.map(code).join(', ')})`;
  return `sign-off email matches neither author nor committer${suffix}`;
}
