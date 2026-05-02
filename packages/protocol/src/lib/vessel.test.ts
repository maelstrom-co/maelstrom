import { describe, expect, test } from 'bun:test';

import { ActionName } from './action-name.js';
import { VariantName } from './variant-name.js';
import type { Vessel, VesselDefinition } from './vessel.js';
import { defineVessel, validateVessel } from './vessel.js';
import { VesselId } from './vessel-id.js';

// Type-level equality: a removed `.transform(<Brand>)` flips the inferred
// type, the `Equals<...>` in the test below resolves to `false`, and tsc
// fails the typecheck. Brands erase at runtime, so this is the only layer
// that can pin the schema-to-type contract.
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
    ? true
    : false;

const validVessel: VesselDefinition = {
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

  test('returns the parsed branded vessel on success', () => {
    const result = validateVessel(validVessel);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('expected valid');
    // Brand erases at runtime; structural equality holds.
    expect(result.vessel.id).toBe(VesselId('calendar'));
    expect(result.vessel.defaultVariant).toBe(VariantName('month'));

    // Runtime: nested fields preserve their string values.
    const monthKey = VariantName('month');
    const showWeek = result.vessel.variants[monthKey]?.actions[0];
    expect(showWeek?.name).toBe(ActionName('showWeek'));
    expect(showWeek?.transitionsTo).toBe(VariantName('week'));

    // Type-level: each `.transform(<Brand>)` on the schema must surface as
    // the branded type on the inferred output. Removing any transform flips
    // the matching `Equals` to `false`, which fails the typecheck.
    type Variants = Vessel['variants'];
    type _VariantKeyBranded = Equals<keyof Variants, VariantName>;
    const _variantKeyBranded: _VariantKeyBranded = true;
    void _variantKeyBranded;

    type ActionEntry = NonNullable<Variants[VariantName]>['actions'][number];
    type _ActionNameBranded = Equals<ActionEntry['name'], ActionName>;
    const _actionNameBranded: _ActionNameBranded = true;
    void _actionNameBranded;

    type _TransitionsToBranded = Equals<
      NonNullable<ActionEntry['transitionsTo']>,
      VariantName
    >;
    const _transitionsToBranded: _TransitionsToBranded = true;
    void _transitionsToBranded;
  });

  test('rejects a vessel with no variants', () => {
    const result = validateVessel({ ...validVessel, variants: {} });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(
      result.issues.some((i) => /at least one variant/.test(i.message)),
    ).toBe(true);
  });

  test('rejects a vessel whose defaultVariant does not exist', () => {
    const result = validateVessel({
      ...validVessel,
      defaultVariant: 'nonexistent',
    });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(
      result.issues.some((i) =>
        /Default variant .* does not exist/.test(i.message),
      ),
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
      result.issues.some((i) =>
        /transitions to non-existent variant/.test(i.message),
      ),
    ).toBe(true);
  });

  test('rejects a vessel with an empty id', () => {
    const result = validateVessel({ ...validVessel, id: '' });
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('expected invalid result');
    expect(
      result.issues.some((i) => /Vessel id is required/.test(i.message)),
    ).toBe(true);
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
    const issue = result.issues.find((i) => /Default variant/.test(i.message));
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
