import type { Verdict } from '../policy/verdict.ts';
import type { Violation } from '../policy/violation.ts';
import { COMMENT_MARKER } from './comment-marker.ts';
import { failBody } from './fail-body.ts';
import { passBody } from './pass-body.ts';
import { withinCommentLimit } from './within-comment-limit.ts';

export function renderComment(verdicts: Verdict[], isFork: boolean): string {
  const violations = verdicts.filter(isViolation);
  const body =
    violations.length === 0
      ? passBody(verdicts)
      : failBody(verdicts, violations, isFork);
  const comment = `${COMMENT_MARKER}\n\n${withinCommentLimit(body)}\n`;
  // Enforced here rather than assumed of the escaping: the next run finds this
  // comment by searching bodies for the marker, and a body that carries a
  // second one makes that find pick between two comments. Failing the run is
  // the safe end of that — `run` renders before it posts, so the alternative is
  // a comment that quietly captures the slot from the real one.
  if (comment.split(COMMENT_MARKER).length !== 2) {
    throw new Error(
      `rendered comment does not carry ${COMMENT_MARKER} exactly once`,
    );
  }
  return comment;
}

function isViolation(verdict: Verdict): verdict is Violation {
  return verdict.state === 'violation';
}
