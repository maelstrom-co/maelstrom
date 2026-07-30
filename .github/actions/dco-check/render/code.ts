// Names, emails, and sign-off addresses all come from a fork's commit metadata,
// and this comment is posted by a workflow holding `pull-requests: write` — so
// every one of those strings is chosen by whoever opened the pull request, and
// a contributor must not be able to shape the bot's own words. Hence the rule
// these modules keep: externally-sourced text is only ever rendered through
// `code()`, never interpolated into a row directly. The code span is what makes
// angle brackets, emphasis, and links inert; `escapeCell` covers the three
// characters that can leave the span.
export function code(value: string): string {
  return `\`${escapeCell(value)}\``;
}

function escapeCell(value: string): string {
  // GFM splits rows before inline parsing, and that scanner reads a backslash
  // as escaping whatever follows — so a backslash the value brought with it
  // consumes the next character, which is either the escape the pipe rule adds
  // (handing the scanner a live cell delimiter and cutting the span in half) or
  // the span's own closing backtick. Backslashes therefore have to be escaped,
  // and escaped first: doing it after the pipe rule would re-escape the
  // backslash that rule just introduced and put the delimiter back.
  //
  // A backtick is substituted rather than escaped, because backslash escapes do
  // not work inside a code span, so `\`` would still close it. Both trades cost
  // fidelity, never safety: GFM strips the backslash only before a pipe, so a
  // `\\` pair reaches the cell whole and a value holding one backslash renders
  // as two.
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('`', "'");
}
