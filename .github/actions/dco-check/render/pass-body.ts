import type { Verdict } from '../policy/verdict.ts';
import { EXEMPT_LABEL } from './exempt-label.ts';

export function passBody(verdicts: Verdict[]): string {
  const signed = verdicts.filter(
    (verdict) => verdict.state === 'signed',
  ).length;
  if (signed === 0) {
    return `**DCO** ✓ no commit required a sign-off.${exemptNote(verdicts)}`;
  }
  const subject =
    signed === 1 ? 'the single commit carries' : `all ${signed} commits carry`;
  return `**DCO** ✓ ${subject} a matching \`Signed-off-by\` trailer.${exemptNote(verdicts)}`;
}

function exemptNote(verdicts: Verdict[]): string {
  const exempt = verdicts.filter(isExempt);
  if (exempt.length === 0) {
    return '';
  }
  const categories = Object.entries(EXEMPT_LABEL)
    .filter(([reason]) => exempt.some((verdict) => verdict.reason === reason))
    .map(([, label]) => `${label}s`);
  return ` (${exempt.length} exempt: ${categories.join(', ')})`;
}

function isExempt(
  verdict: Verdict,
): verdict is Extract<Verdict, { state: 'exempt' }> {
  return verdict.state === 'exempt';
}
