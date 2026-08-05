// Must lead the body and appear exactly once: the sticky comment is located by
// searching existing comments for this substring, so a second occurrence
// anywhere in the body makes the find ambiguous.
export const COMMENT_MARKER = '<!-- dco-check -->';
