export type FormulaBinaryOp = '+' | '-' | '*' | '/';
export type FormulaUnaryOp = '+' | '-';

export type FormulaNode =
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'ref'; readonly name: string }
  | {
      readonly type: 'unary';
      readonly op: FormulaUnaryOp;
      readonly operand: FormulaNode;
    }
  | {
      readonly type: 'binary';
      readonly op: FormulaBinaryOp;
      readonly left: FormulaNode;
      readonly right: FormulaNode;
    };

export type FormulaParseResult =
  | {
      readonly ok: true;
      readonly ast: FormulaNode;
      readonly references: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'empty_formula' | 'syntax_error';
      readonly message: string;
    };

export type FormulaEvalResult =
  | { readonly ok: true; readonly value: number }
  | {
      readonly ok: false;
      readonly reason:
        | 'unknown_column'
        | 'division_by_zero'
        | 'non_numeric_value';
      readonly column?: string;
      readonly message: string;
    };

export type ColumnValueLookup = (
  reference: string,
) =>
  | { readonly found: true; readonly value: unknown }
  | { readonly found: false };

export function parseFormula(source: string): FormulaParseResult {
  const trimmed = source.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: 'empty_formula',
      message: 'Formula cannot be empty.',
    };
  }
  if (trimmed.length > MAX_FORMULA_LENGTH) {
    return {
      ok: false,
      reason: 'syntax_error',
      message: `Formula is too long (max ${MAX_FORMULA_LENGTH} characters).`,
    };
  }

  const tokenized = tokenize(trimmed);
  if (!tokenized.ok) return tokenized;

  const parser = new FormulaParser(tokenized.tokens);
  const parsed = parser.parse();
  if (!parsed.ok) return parsed;

  const references: string[] = [];
  collectReferences(parsed.node, references);
  return { ok: true, ast: parsed.node, references };
}

export function evaluateFormulaNode(
  node: FormulaNode,
  lookup: ColumnValueLookup,
): FormulaEvalResult {
  switch (node.type) {
    case 'number':
      return { ok: true, value: normalizeZero(node.value) };
    case 'ref': {
      const resolved = lookup(node.name);
      if (!resolved.found) {
        return {
          ok: false,
          reason: 'unknown_column',
          column: node.name,
          message: `Unknown column "${node.name}" in formula.`,
        };
      }
      const numeric = toFiniteNumber(resolved.value);
      if (numeric === undefined) {
        return {
          ok: false,
          reason: 'non_numeric_value',
          column: node.name,
          message: `Column "${node.name}" does not contain a numeric value.`,
        };
      }
      return { ok: true, value: normalizeZero(numeric) };
    }
    case 'unary': {
      const operand = evaluateFormulaNode(node.operand, lookup);
      if (!operand.ok) return operand;
      const value = node.op === '-' ? -operand.value : operand.value;
      return { ok: true, value: normalizeZero(value) };
    }
    case 'binary': {
      const left = evaluateFormulaNode(node.left, lookup);
      if (!left.ok) return left;
      const right = evaluateFormulaNode(node.right, lookup);
      if (!right.ok) return right;

      let value: number;
      switch (node.op) {
        case '+':
          value = left.value + right.value;
          break;
        case '-':
          value = left.value - right.value;
          break;
        case '*':
          value = left.value * right.value;
          break;
        case '/':
          if (right.value === 0) {
            return {
              ok: false,
              reason: 'division_by_zero',
              message: 'Division by zero in formula.',
            };
          }
          value = left.value / right.value;
          break;
      }

      if (!Number.isFinite(value)) {
        return {
          ok: false,
          reason: 'division_by_zero',
          message: 'Formula produced a non-finite number.',
        };
      }
      return { ok: true, value: normalizeZero(value) };
    }
  }
}

export function evaluateFormula(
  source: string,
  lookup: ColumnValueLookup,
):
  | FormulaEvalResult
  | {
      readonly ok: false;
      readonly reason: 'empty_formula' | 'syntax_error';
      readonly message: string;
    } {
  const parsed = parseFormula(source);
  if (!parsed.ok) return parsed;
  return evaluateFormulaNode(parsed.ast, lookup);
}

const MAX_FORMULA_LENGTH = 500;

type Token =
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'ref'; readonly name: string }
  | { readonly type: 'op'; readonly value: FormulaBinaryOp }
  | { readonly type: 'lparen' }
  | { readonly type: 'rparen' };

type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | {
      readonly ok: false;
      readonly reason: 'syntax_error';
      readonly message: string;
    };

function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const ch = source[index] as string;
    if (/\s/.test(ch)) {
      index++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      index++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      index++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      index++;
      continue;
    }

    if (ch === '[') {
      const closeIndex = source.indexOf(']', index + 1);
      if (closeIndex === -1) {
        return {
          ok: false,
          reason: 'syntax_error',
          message: 'Unclosed column reference "[".',
        };
      }
      const name = source.slice(index + 1, closeIndex).trim();
      if (!name) {
        return {
          ok: false,
          reason: 'syntax_error',
          message: 'Empty column reference "[]".',
        };
      }
      tokens.push({ type: 'ref', name });
      index = closeIndex + 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const start = index;
      let dots = 0;
      while (index < source.length && /[0-9.]/.test(source[index] as string)) {
        if (source[index] === '.') dots++;
        index++;
      }
      const raw = source.slice(start, index);
      if (dots > 1 || raw === '.') {
        return {
          ok: false,
          reason: 'syntax_error',
          message: `Invalid number "${raw}" in formula.`,
        };
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          reason: 'syntax_error',
          message: `Invalid number "${raw}" in formula.`,
        };
      }
      tokens.push({ type: 'number', value });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = index;
      while (
        index < source.length &&
        /[A-Za-z0-9_]/.test(source[index] as string)
      ) {
        index++;
      }
      tokens.push({ type: 'ref', name: source.slice(start, index) });
      continue;
    }

    return {
      ok: false,
      reason: 'syntax_error',
      message: `Unexpected character "${ch}" in formula.`,
    };
  }

  return { ok: true, tokens };
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse():
    | { readonly ok: true; readonly node: FormulaNode }
    | {
        readonly ok: false;
        readonly reason: 'syntax_error';
        readonly message: string;
      } {
    const expr = this.parseExpression();
    if (!expr.ok) return expr;
    if (this.index < this.tokens.length) {
      return {
        ok: false,
        reason: 'syntax_error',
        message: 'Unexpected token after end of expression.',
      };
    }
    return expr;
  }

  private parseExpression():
    | { readonly ok: true; readonly node: FormulaNode }
    | {
        readonly ok: false;
        readonly reason: 'syntax_error';
        readonly message: string;
      } {
    let left = this.parseTerm();
    if (!left.ok) return left;

    while (true) {
      const next = this.peek();
      if (next?.type !== 'op' || (next.value !== '+' && next.value !== '-')) {
        break;
      }
      this.index++;
      const right = this.parseTerm();
      if (!right.ok) return right;
      left = {
        ok: true,
        node: {
          type: 'binary',
          op: next.value,
          left: left.node,
          right: right.node,
        },
      };
    }

    return left;
  }

  private parseTerm():
    | { readonly ok: true; readonly node: FormulaNode }
    | {
        readonly ok: false;
        readonly reason: 'syntax_error';
        readonly message: string;
      } {
    let left = this.parseUnary();
    if (!left.ok) return left;

    while (true) {
      const next = this.peek();
      if (next?.type !== 'op' || (next.value !== '*' && next.value !== '/')) {
        break;
      }
      this.index++;
      const right = this.parseUnary();
      if (!right.ok) return right;
      left = {
        ok: true,
        node: {
          type: 'binary',
          op: next.value,
          left: left.node,
          right: right.node,
        },
      };
    }

    return left;
  }

  private parseUnary():
    | { readonly ok: true; readonly node: FormulaNode }
    | {
        readonly ok: false;
        readonly reason: 'syntax_error';
        readonly message: string;
      } {
    const next = this.peek();
    if (next?.type === 'op' && (next.value === '+' || next.value === '-')) {
      this.index++;
      const operand = this.parseUnary();
      if (!operand.ok) return operand;
      return {
        ok: true,
        node: { type: 'unary', op: next.value, operand: operand.node },
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary():
    | { readonly ok: true; readonly node: FormulaNode }
    | {
        readonly ok: false;
        readonly reason: 'syntax_error';
        readonly message: string;
      } {
    const next = this.peek();
    if (!next) {
      return {
        ok: false,
        reason: 'syntax_error',
        message: 'Unexpected end of formula.',
      };
    }

    if (next.type === 'number') {
      this.index++;
      return { ok: true, node: { type: 'number', value: next.value } };
    }

    if (next.type === 'ref') {
      this.index++;
      return { ok: true, node: { type: 'ref', name: next.name } };
    }

    if (next.type === 'lparen') {
      this.index++;
      const inner = this.parseExpression();
      if (!inner.ok) return inner;
      if (this.peek()?.type !== 'rparen') {
        return {
          ok: false,
          reason: 'syntax_error',
          message: 'Missing closing parenthesis ")".',
        };
      }
      this.index++;
      return inner;
    }

    return {
      ok: false,
      reason: 'syntax_error',
      message: 'Expected a number, column reference, or "(".',
    };
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }
}

function collectReferences(node: FormulaNode, out: string[]): void {
  switch (node.type) {
    case 'number':
      return;
    case 'ref':
      if (!out.includes(node.name)) out.push(node.name);
      return;
    case 'unary':
      collectReferences(node.operand, out);
      return;
    case 'binary':
      collectReferences(node.left, out);
      collectReferences(node.right, out);
      return;
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
