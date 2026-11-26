import { describe, expect, it } from 'vitest';

import { evaluateFormula, parseFormula } from './flexible-table-formula';

describe('flexible-table formula parser and evaluator', () => {
  it('evaluates arithmetic with operator precedence and parentheses', () => {
    const lookup = (name: string) => {
      const values: Record<string, number> = {
        estimate: 6,
        spent: 2,
        buffer: 1.5,
      };
      return name in values
        ? { found: true as const, value: values[name] }
        : { found: false as const };
    };

    expect(evaluateFormula('estimate + spent', lookup)).toEqual({
      ok: true,
      value: 8,
    });
    expect(evaluateFormula('estimate + spent * 3', lookup)).toEqual({
      ok: true,
      value: 12,
    });
    expect(evaluateFormula('(estimate + spent) * 3', lookup)).toEqual({
      ok: true,
      value: 24,
    });
    expect(evaluateFormula('(estimate - spent) / 2 + buffer', lookup)).toEqual({
      ok: true,
      value: 3.5,
    });
    expect(evaluateFormula('-spent + estimate', lookup)).toEqual({
      ok: true,
      value: 4,
    });
  });

  it('supports bracketed column references with spaces', () => {
    const lookup = (name: string) =>
      name === 'Story Points'
        ? { found: true as const, value: 5 }
        : { found: false as const };

    expect(evaluateFormula('[Story Points] * 2', lookup)).toEqual({
      ok: true,
      value: 10,
    });
  });

  it('returns division_by_zero instead of Infinity or NaN', () => {
    const lookup = (name: string) =>
      name === 'estimate'
        ? { found: true as const, value: 4 }
        : name === 'spent'
          ? { found: true as const, value: 0 }
          : { found: false as const };

    expect(evaluateFormula('estimate / spent', lookup)).toMatchObject({
      ok: false,
      reason: 'division_by_zero',
    });
    expect(evaluateFormula('10 / (2 - 2)', lookup)).toMatchObject({
      ok: false,
      reason: 'division_by_zero',
    });
  });

  it('returns unknown_column when a referenced column is missing', () => {
    const lookup = () => ({ found: false as const });
    expect(evaluateFormula('estimate + mystery', lookup)).toMatchObject({
      ok: false,
      reason: 'unknown_column',
      column: 'estimate',
    });
  });

  it('returns non_numeric_value when a referenced column is not a number', () => {
    const lookup = (name: string) =>
      name === 'title'
        ? { found: true as const, value: 'Update README' }
        : { found: false as const };

    expect(evaluateFormula('title + 1', lookup)).toMatchObject({
      ok: false,
      reason: 'non_numeric_value',
      column: 'title',
    });
  });

  it('returns typed errors for empty or malformed formulas', () => {
    expect(parseFormula('   ')).toMatchObject({
      ok: false,
      reason: 'empty_formula',
    });
    expect(parseFormula('estimate + * spent')).toMatchObject({
      ok: false,
      reason: 'syntax_error',
    });
    expect(parseFormula('(estimate + spent')).toMatchObject({
      ok: false,
      reason: 'syntax_error',
    });
    expect(parseFormula('estimate + spent)')).toMatchObject({
      ok: false,
      reason: 'syntax_error',
    });
    expect(parseFormula('estimate; alert(1)')).toMatchObject({
      ok: false,
      reason: 'syntax_error',
    });
  });

  it('collects unique referenced column names', () => {
    const parsed = parseFormula('(estimate + spent) / estimate');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.references).toEqual(['estimate', 'spent']);
  });
});
