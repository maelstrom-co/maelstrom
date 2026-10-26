import { expect, test } from 'bun:test';
import {
  assertBoundedSdkValidation,
  assertBundledValidationSources,
  type BoundedSdkSchema,
} from './sdk-validation.ts';

test('a stale client vendor runtime is rejected even when the protocol runtime is patched', () => {
  expect(() =>
    assertBundledValidationSources(
      ['var _zod; var v={major:4,minor:6,patch:6}'],
      'protocol',
    ),
  ).not.toThrow();
  expect(() =>
    assertBundledValidationSources(
      ['var _zod; var v={major:4,minor:4,patch:3}'],
      'client',
    ),
  ).toThrow('client: bundles vulnerable');
});

test('an unidentified embedded validator fails closed instead of inheriting a clean dependency audit', () => {
  expect(() =>
    assertBundledValidationSources(['var _zod = unknownRuntime;'], 'client'),
  ).toThrow('could not be verified');
});

test('packages without embedded validation code do not require a vendor version marker', () => {
  expect(() =>
    assertBundledValidationSources(
      ['export const ready = true;'],
      'connectors',
    ),
  ).not.toThrow();
});

test('the artifact check catches a legacy validator even when its manifest resolves a patched dependency', () => {
  const legacy: BoundedSdkSchema = {
    transform: (visit) => ({
      array: () => ({
        max: () => ({
          safeParse: (input) => {
            input.forEach(visit);
            return { success: false };
          },
        }),
      }),
    }),
  };
  expect(() => assertBoundedSdkValidation(legacy)).toThrow('before parsing');
});

test('the artifact check also rejects a validator that accepts the oversized collection', () => {
  const accepting: BoundedSdkSchema = {
    transform: () => ({
      array: () => ({ max: () => ({ safeParse: () => ({ success: true }) }) }),
    }),
  };
  expect(() => assertBoundedSdkValidation(accepting)).toThrow(
    'reject oversized',
  );
});
