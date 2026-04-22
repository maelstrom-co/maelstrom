import { describe, expect, test } from 'bun:test';

import type { Vessel } from './vessel.js';
import { defineVessel, validateVessel } from './vessel.js';

const validVessel: Vessel = {
  id: 'calendar',
  name: 'Calendar',
  description: 'Displays events',
  defaultVariant: 'month',
  variants: {
    month: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to week view',
          transitionsTo: 'week',
        },
      ],
    },
    week: {
      props: {},
      minSize: { width: 6, height: 4 },
      actions: [],
    },
  },
};

describe('validateVessel', () => {
  test('accepts a well-formed vessel', () => {
    const result = validateVessel(validVessel);
    expect(result.valid).toBe(true);
  });

  test('rejects a vessel with no variants', () => {
    const result = validateVessel({ ...validVessel, variants: {} });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(result.issues.some((i) => /at least one variant/.test(i.message)))
      .toBe(true);
  });

  test('rejects a vessel whose defaultVariant does not exist', () => {
    const result = validateVessel({
      ...validVessel,
      defaultVariant: 'nonexistent',
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(
      result.issues.some((i) => /Default variant .* does not exist/.test(i.message)),
    ).toBe(true);
  });

  test('rejects a vessel with duplicate action names inside one variant', () => {
    const result = validateVessel({
      ...validVessel,
      variants: {
        month: {
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            { name: 'show', description: 'show something' },
            { name: 'show', description: 'show again' },
          ],
        },
      },
      defaultVariant: 'month',
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(
      result.issues.some((i) => /Duplicate action name/.test(i.message)),
    ).toBe(true);
  });

  test('rejects an action that transitions to a non-existent variant', () => {
    const result = validateVessel({
      ...validVessel,
      variants: {
        month: {
          props: {},
          minSize: { width: 4, height: 4 },
          actions: [
            {
              name: 'showMissing',
              description: 'transitions to a variant that does not exist',
              transitionsTo: 'ghost',
            },
          ],
        },
      },
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(
      result.issues.some((i) => /transitions to non-existent variant/.test(i.message)),
    ).toBe(true);
  });

  test('rejects a vessel with an empty id', () => {
    const result = validateVessel({ ...validVessel, id: '' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(result.issues.some((i) => /Vessel id is required/.test(i.message)))
      .toBe(true);
  });

  test('rejects a non-object input', () => {
    expect(validateVessel(null).valid).toBe(false);
    expect(validateVessel('not a vessel').valid).toBe(false);
    expect(validateVessel(42).valid).toBe(false);
  });

  test('issues carry path, code, and message', () => {
    const result = validateVessel({
      ...validVessel,
      defaultVariant: 'nonexistent',
    });
    if (result.valid) throw new Error('expected invalid result');
    const issue = result.issues.find((i) =>
      /Default variant/.test(i.message),
    );
    expect(issue).toBeDefined();
    expect(issue!.path).toContain('defaultVariant');
    expect(typeof issue!.code).toBe('string');
  });
});

describe('defineVessel', () => {
  test('returns its input unchanged at runtime', () => {
    const v = defineVessel(validVessel);
    expect(v).toBe(validVessel);
  });

  test('preserves literal types of action names for inference', () => {
    const v = defineVessel({
      id: 'orders',
      name: 'Orders',
      description: 'Order tracking',
      defaultVariant: 'list',
      variants: {
        list: {
          props: {},
          minSize: { width: 2, height: 2 },
          actions: [{ name: 'select', description: 'Select an order' }],
        },
      },
    });
    // The literal 'select' is preserved on the action name — a plain Vessel
    // would widen to string.
    const firstAction = v.variants.list.actions[0];
    expect(firstAction?.name).toBe('select');
  });
});
