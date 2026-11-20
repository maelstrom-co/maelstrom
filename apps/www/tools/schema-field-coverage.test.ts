import { describe, expect, it } from 'bun:test';

import { findFieldsDroppedByParse } from './schema-field-coverage';

describe('findFieldsDroppedByParse', () => {
  it('reports nothing when the parse keeps every field', () => {
    const input = {
      id: 'orders',
      variants: {
        list: { actions: [{ name: 'selectOrder', parameters: [] }] },
      },
    };
    expect(findFieldsDroppedByParse(input, structuredClone(input))).toEqual([]);
  });

  it('reports a field stripped from an array element by its full path', () => {
    const input = {
      variants: {
        list: { actions: [{ name: 'selectOrder', effect: 'none' }] },
      },
    };
    const parsed = {
      variants: { list: { actions: [{ name: 'selectOrder' }] } },
    };
    expect(findFieldsDroppedByParse(input, parsed)).toEqual([
      'variants.list.actions.0.effect',
    ]);
  });

  it('reports every dropped field, including dropped array elements', () => {
    const input = { tree: ['ID:a', 'ID:b'], extra: 1, layout: { kept: 1 } };
    const parsed = { tree: ['ID:a'], layout: {} };
    expect(findFieldsDroppedByParse(input, parsed)).toEqual([
      'tree.1',
      'extra',
      'layout.kept',
    ]);
  });

  it('ignores fields the parse adds, such as defaults', () => {
    const input = { actions: [{ name: 'selectOrder' }] };
    const parsed = { actions: [{ name: 'selectOrder', idempotent: false }] };
    expect(findFieldsDroppedByParse(input, parsed)).toEqual([]);
  });

  it('reports an object field the parse replaced with a primitive', () => {
    const input = { params: { orderId: '1847' } };
    const parsed = { params: 'orderId=1847' };
    expect(findFieldsDroppedByParse(input, parsed)).toEqual(['params.orderId']);
  });

  it('accepts primitive values that the parse transforms', () => {
    expect(
      findFieldsDroppedByParse({ name: 'selectOrder' }, { name: 'SELECT' }),
    ).toEqual([]);
    expect(findFieldsDroppedByParse('orders', 'orders')).toEqual([]);
  });
});
