import { COMMENT_MARKER } from './comment-marker.ts';
import { CONTRIBUTING_DCO_URL } from './contributing-dco-url.ts';
import { withinCommentLimit } from './within-comment-limit.ts';

export function unauditableBody(reason: string): string {
  const body = [
    `**DCO** ✗ this check could not audit the pull request: ${reason}.`,
    '',
    'Nothing was decided about the sign-offs either way — the check fails closed',
    'rather than report a pass over commits it never saw. Pushing to the branch',
    'runs it again.',
    '',
    `See [the DCO section of CONTRIBUTING.md](${CONTRIBUTING_DCO_URL}).`,
  ].join('\n');
  const comment = `${COMMENT_MARKER}\n\n${withinCommentLimit(body)}\n`;
  // The next run finds this comment by searching bodies for the marker, so a
  // reason carrying a second one would make that find pick between two
  // comments. Throwing is the safe end of that: the caller renders before it
  // posts, so the alternative is a comment that quietly captures the slot.
  if (comment.split(COMMENT_MARKER).length !== 2) {
    throw new Error(
      `rendered comment does not carry ${COMMENT_MARKER} exactly once`,
    );
  }
  return comment;
}
