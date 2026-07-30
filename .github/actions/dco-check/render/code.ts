// Names, emails, and sign-off addresses all come from a fork's commit metadata,
// and this comment is posted by a workflow holding `pull-requests: write` — so
// every one of those strings is chosen by whoever opened the pull request, and
// a contributor must not be able to shape the bot's own words. Hence the rule
// these modules keep: externally-sourced text is only ever rendered through
// `code()`, never interpolated into a row directly. The code span is what makes
// angle brackets, emphasis, and links inert; `escapeCell` covers the two
// characters that can leave the span.
export function code(value: string): string {
  return `\`${escapeCell(value)}\``;
}

function escapeCell(value: string): string {
  // A backtick is substituted rather than escaped: backslash escapes do not
  // work inside a code span, so `\`` would still close it. GFM resolves `\|`
  // before inline parsing, so the pipe can be escaped in place.
  return value.replaceAll('|', '\\|').replaceAll('`', "'");
}
