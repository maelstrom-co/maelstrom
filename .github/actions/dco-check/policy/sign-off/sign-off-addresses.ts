import { normalizeEmail } from './normalize-email.ts';

// The trailer count is reported alongside the addresses because the two facts
// are not interchangeable: no trailer at all is a missing sign-off, while a
// trailer that parses to no address is a mismatch. Collapsing them to an empty
// address list would lose that distinction at the call site.
export function signOffAddresses(message: string): {
  trailerCount: number;
  addresses: string[];
} {
  const trailers = signOffTrailers(message);
  return {
    trailerCount: trailers.length,
    addresses: trailers.flatMap((trailer) => addressOf(trailer) ?? []),
  };
}

// Lines are split on `\n` rather than left to the regex `m` flag, which also
// anchors `^` after CR, U+2028 and U+2029. Git splits a commit message on LF
// alone, so any of those inside a line would let a message that carries no
// trailer at all present one and pass the check.
function signOffTrailers(message: string): string[] {
  return message
    .split('\n')
    .flatMap((line) => SIGN_OFF_TRAILER.exec(line)?.[1] ?? []);
}

// Case-sensitive literal prefix anchored to line start: a trailer is a
// line-start construct, so `signed-off-by:` and an indented line are not
// trailers. The horizontal-whitespace class is deliberate — `\s*` would match
// the newline after a bare prefix and capture the next line as the value.
// `[^\n]*` rather than `.*` keeps the trailing CR of a CRLF message, which the
// address parser tolerates.
const SIGN_OFF_TRAILER = /^Signed-off-by:[ \t]*([^\n]*)$/;

function addressOf(trailerValue: string): string | undefined {
  const address = normalizeEmail(
    SIGN_OFF_ADDRESS.exec(trailerValue)?.[1] ?? '',
  );
  // An empty address is rejected here, at the parse boundary: left to stand it
  // would match a commit whose author and committer emails are themselves
  // empty, certifying a commit nobody signed.
  return address === '' ? undefined : address;
}

// The final `<…>` pair on the line, with anything after it (a CRLF `\r`, say)
// tolerated.
const SIGN_OFF_ADDRESS = /<([^<>]*)>[^>]*$/;
