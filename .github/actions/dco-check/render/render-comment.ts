import type { Verdict } from '../policy/verdict.ts';
import type { Violation } from '../policy/violation.ts';
import { COMMENT_MARKER } from './comment-marker.ts';
import { failBody } from './fail-body.ts';
import { passBody } from './pass-body.ts';

export function renderComment(verdicts: Verdict[]): string {
  const violations = verdicts.filter(isViolation);
  const body =
    violations.length === 0
      ? passBody(verdicts)
      : failBody(verdicts, violations);
  return `${COMMENT_MARKER}\n\n${body}\n`;
}

function isViolation(verdict: Verdict): verdict is Violation {
  return verdict.state === 'violation';
}
