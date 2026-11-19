/**
 * Highlights TypeScript, TSX or JSON source as HTML with `tk-*` token spans.
 * All source text is HTML-escaped, so removing the tags and decoding the
 * entities gives back the input exactly, whitespace included.
 */
export function highlightTypeScript(source: string): string {
  const tokens = scanTokens(source);
  const significant = tokens.filter(
    (token) => token.kind !== 'space' && token.kind !== 'comment',
  );
  const significantClasses: (TokenClass | undefined)[] = [];
  for (const index of significant.keys()) {
    significantClasses.push(
      classifyToken(significant, index, significantClasses),
    );
  }
  const classes = new Map(
    significant.map((token, index) => [token, significantClasses[index]]),
  );

  return tokens
    .map((token) => {
      const tokenClass =
        token.kind === 'comment' ? 'tk-com' : classes.get(token);
      const text = escapeHtml(token.text);
      return tokenClass ? `<span class="${tokenClass}">${text}</span>` : text;
    })
    .join('');
}

type TokenClass =
  | 'tk-key'
  | 'tk-fn'
  | 'tk-str'
  | 'tk-num'
  | 'tk-com'
  | 'tk-ty'
  | 'tk-var'
  | 'tk-att';

type TokenKind =
  | 'space'
  | 'comment'
  | 'string'
  | 'number'
  | 'word'
  | 'punctuation';

type OpenBracket = '{' | '(' | '[' | 'template';

interface ScannedToken {
  readonly kind: TokenKind;
  readonly text: string;
  readonly enclosing: OpenBracket | undefined;
}

// Template literals are scanned separately because their substitutions nest.
const TOKEN_PATTERNS: readonly (readonly [TokenKind, RegExp])[] = [
  ['space', /\s+/y],
  ['comment', /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/y],
  ['string', /'(?:[^'\\\r\n]|\\[\s\S])*'?|"(?:[^"\\\r\n]|\\[\s\S])*"?/y],
  [
    'number',
    /(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y,
  ],
  ['word', /[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*/uy],
  [
    'punctuation',
    /\.\.\.|\?\.(?!\d)|=>|[=!]==?|[<>]=|&&=?|\|\|=?|\?\?=?|\*\*=?|<\/(?!\*)|[-+*/%&|^]=|\+\+|--|[\s\S]/uy,
  ],
];

const KEYWORDS: ReadonlySet<string> = new Set([
  'abstract',
  'any',
  'as',
  'async',
  'await',
  'bigint',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'unknown',
  'using',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

// Tokens after which a capitalized name reads as a type or a JSX tag.
const TYPE_POSITION_PREDECESSORS: ReadonlySet<string> = new Set([
  '<',
  '</',
  '|',
  '&',
  'extends',
  'implements',
  'as',
  'satisfies',
  'keyof',
  'type',
  'interface',
  'class',
  'enum',
]);

// Punctuation allowed between the angle brackets of a generic call like `useState<string>()`.
const TYPE_ARGUMENT_PUNCTUATION: ReadonlySet<string> = new Set([
  ',',
  '.',
  '[',
  ']',
  '|',
  '&',
]);

// Splits the whole source into tokens, so joining their text gives back the source.
function scanTokens(source: string): ScannedToken[] {
  const tokens: ScannedToken[] = [];
  const openBrackets: OpenBracket[] = [];
  let position = 0;

  while (position < source.length) {
    const char = source[position];
    if (char === '`' || (char === '}' && openBrackets.at(-1) === 'template')) {
      if (char === '}') openBrackets.pop();
      const template = scanTemplateText(source, position + 1);
      tokens.push({
        kind: 'string',
        text: source.slice(position, template.end),
        enclosing: openBrackets.at(-1),
      });
      if (template.opensSubstitution) openBrackets.push('template');
      position = template.end;
      continue;
    }

    const [kind, text] = matchToken(source, position);
    tokens.push({ kind, text, enclosing: openBrackets.at(-1) });
    if (kind === 'punctuation') trackBrackets(openBrackets, text);
    position += text.length;
  }
  return tokens;
}

function matchToken(source: string, position: number): [TokenKind, string] {
  for (const [kind, pattern] of TOKEN_PATTERNS) {
    pattern.lastIndex = position;
    const text = pattern.exec(source)?.[0];
    if (text) return [kind, text];
  }
  return ['punctuation', source.slice(position)];
}

// Reads template text up to the closing backtick or the next `${`.
function scanTemplateText(source: string, from: number) {
  let cursor = from;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
    } else if (char === '`') {
      return { end: cursor + 1, opensSubstitution: false };
    } else if (char === '$' && source[cursor + 1] === '{') {
      return { end: cursor + 2, opensSubstitution: true };
    } else {
      cursor++;
    }
  }
  return { end: source.length, opensSubstitution: false };
}

function trackBrackets(openBrackets: OpenBracket[], punctuation: string) {
  if (punctuation === '{' || punctuation === '(' || punctuation === '[') {
    openBrackets.push(punctuation);
  } else if (
    punctuation === '}' ||
    punctuation === ')' ||
    punctuation === ']'
  ) {
    openBrackets.pop();
  }
}

function classifyToken(
  significant: readonly ScannedToken[],
  index: number,
  earlierClasses: readonly (TokenClass | undefined)[],
): TokenClass | undefined {
  const token = significant[index];
  if (!token) return undefined;
  if (token.kind === 'string') {
    return isObjectKey(significant, index) ? 'tk-att' : 'tk-str';
  }
  if (token.kind === 'number') return 'tk-num';
  if (token.kind !== 'word') return undefined;
  if (isObjectKey(significant, index)) return 'tk-att';

  const previous = significant[index - 1]?.text;
  const isName =
    !KEYWORDS.has(token.text) || previous === '.' || previous === '?.';
  if (!isName) return 'tk-key';
  if (isCallee(significant, index)) return 'tk-fn';
  if (
    /^[A-Z]/.test(token.text) &&
    isTypePosition(significant, index, earlierClasses)
  ) {
    return 'tk-ty';
  }
  return 'tk-var';
}

// A key in an object literal, type literal or JSON object: `{ key:` or `, key:`.
function isObjectKey(significant: readonly ScannedToken[], index: number) {
  const previous = significant[index - 1]?.text;
  return (
    significant[index]?.enclosing === '{' &&
    (previous === '{' || previous === ',') &&
    significant[index + 1]?.text === ':'
  );
}

// A name followed by a call, optionally with type arguments: `run(` or `run<T>(`.
function isCallee(significant: readonly ScannedToken[], index: number) {
  const next = significant[index + 1]?.text;
  if (next === '(') return true;
  if (next !== '<') return false;

  let depth = 0;
  for (let cursor = index + 1; cursor < significant.length; cursor++) {
    const token = significant[cursor];
    if (token?.text === '<') {
      depth++;
    } else if (token?.text === '>') {
      depth--;
      if (depth === 0) return significant[cursor + 1]?.text === '(';
    } else if (
      !token ||
      (token.kind === 'punctuation' &&
        !TYPE_ARGUMENT_PUNCTUATION.has(token.text))
    ) {
      return false;
    }
  }
  return false;
}

// The colon after an object key starts a value, any other colon starts a type annotation.
function isTypePosition(
  significant: readonly ScannedToken[],
  index: number,
  earlierClasses: readonly (TokenClass | undefined)[],
) {
  const previous = significant[index - 1]?.text;
  if (previous === undefined) return false;
  if (TYPE_POSITION_PREDECESSORS.has(previous)) return true;
  if (previous === ':') return earlierClasses[index - 2] !== 'tk-att';
  return previous === '/' && significant[index - 2]?.text === '<';
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
