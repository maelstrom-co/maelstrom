import { truncate } from './truncate.ts';

// A backstop, not the mechanism: the row and cell caps bound what this renderer
// emits today, this bounds what any later edit to it can emit. GitHub answers
// an over-long body with a 422, and losing the comment is invisible to the
// contributor — the check still fails, but the only explanation of why never
// appears. With the caps in place this never fires.
export function withinCommentLimit(body: string): string {
  if (body.length <= BODY_LIMIT) {
    return body;
  }
  return `${truncate(body, BODY_LIMIT)}\n\n${TRUNCATION_NOTICE}`;
}

// Compared in UTF-16 units but cut in code points, and that asymmetry is
// deliberate: GitHub counts the characters, so the cut is in the unit that
// matters and the comparison errs towards cutting early.
const BODY_LIMIT = 60_000;

const TRUNCATION_NOTICE =
  'This comment was truncated to fit the GitHub comment size limit. The full table is in the workflow job log.';
