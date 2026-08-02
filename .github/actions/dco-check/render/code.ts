// Names, emails, and sign-off addresses all come from a fork's commit metadata,
// and this comment is posted by a workflow holding `pull-requests: write` — so
// every one of those strings is chosen by whoever opened the pull request, and
// a contributor must not be able to shape the bot's own words. Hence the rule
// these modules keep: externally-sourced text is only ever rendered through
// `code()`, never interpolated into a row directly. The code span is what makes
// angle brackets, emphasis, and links inert; `escapeCell` covers the characters
// that can leave the span.
export function code(value: string): string {
  return `\`${escapeCell(value)}\``;
}

function escapeCell(value: string): string {
  // A line ending ends the row before any of the rules below can apply: GFM
  // scans rows a line at a time, so a carriage return inside a value splits the
  // row and hands the rest of the value to the block parser as its own line —
  // free to close the table and write whatever it likes under the bot's name.
  // Git strips a newline out of an identity but permits a carriage return, so
  // that is reachable. Every control character is replaced rather than only the
  // two line endings: none of them belongs in a name, an address, or a SHA, and
  // a visible replacement is the honest rendering of one that turns up anyway.
  //
  // GFM splits rows before inline parsing, and that scanner reads a backslash
  // as escaping whatever follows — so a backslash the value brought with it
  // consumes the next character, which is either the escape the pipe rule adds
  // (handing the scanner a live cell delimiter and cutting the span in half) or
  // the span's own closing backtick. Backslashes therefore have to be escaped,
  // and escaped before the pipe rule: doing it after would re-escape the
  // backslash that rule just introduced and put the delimiter back.
  //
  // A backtick is substituted rather than escaped, because backslash escapes do
  // not work inside a code span, so `\`` would still close it. Both trades cost
  // fidelity, never safety: GFM strips the backslash only before a pipe, so a
  // `\\` pair reaches the cell whole and a value holding one backslash renders
  // as two.
  //
  // The comment opener is neutralised on top of that, and only the opener, not
  // every `<`: an identity cell is a whole `Name <email>` string, so touching
  // the bracket itself would mangle every honest row. The sequence has to go
  // because the sticky comment is found by searching bodies for an HTML comment
  // marker — a code span makes the marker inert to a reader, not to a substring
  // search, and a value carrying one makes that find ambiguous.
  return value
    .replaceAll(CONTROL, '�')
    .replaceAll('<!', '<�')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('`', "'");
}

// Matched by Unicode property rather than by an explicit escape range: spelling
// the range out is what `noControlCharactersInRegex` exists to flag, and a
// suppression on the one line whose whole job is to neutralise those characters
// would read as the rule being wrong rather than as it being satisfied.
//
// `Cf` is here for spoofing rather than for containment: a bidi override or a
// zero-width space inside a name makes an address render as one it is not, in a
// comment whose whole job is to say which address signed off. It costs
// fidelity — U+200D is what holds an emoji sequence together, so a name
// carrying one renders with a replacement character through the middle of it —
// and that is the trade, not an oversight. Between ordinary letters a joiner is
// as invisible as a zero-width space, so exempting it reopens the hole it was
// added to close, and the replacement character at least says an invisible
// character was there.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
