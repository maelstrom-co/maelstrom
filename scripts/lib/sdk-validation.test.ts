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

test('the last vulnerable patch is rejected at the boundary of the security fix', () => {
  expect(() =>
    assertBundledValidationSources(
      ['var _zod; var v={major:4,minor:6,patch:5}'],
      'client',
    ),
  ).toThrow('client: bundles vulnerable Zod 4.6.5');
});

test('an unidentified embedded validator fails closed instead of inheriting a clean dependency audit', () => {
  expect(() =>
    assertBundledValidationSources(['var _zod = unknownRuntime;'], 'client'),
  ).toThrow('could not be verified');
});

test('a separate runtime cannot lend its version marker to an unidentified validator', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var _zod = unknownRuntime;',
        'var version = {major:4,minor:6,patch:6};',
      ],
      'client',
    ),
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
            return { success: input.length <= 1 };
          },
        }),
      }),
    }),
  };
  expect(() => assertBoundedSdkValidation(legacy)).toThrow('before parsing');
});

test('the artifact check also rejects a validator that accepts the oversized collection', () => {
  const accepting: BoundedSdkSchema = {
    transform: (visit) => ({
      array: () => ({
        max: () => ({
          safeParse: (input) => {
            if (input.length === 1) input.forEach(visit);
            return { success: true };
          },
        }),
      }),
    }),
  };
  expect(() => assertBoundedSdkValidation(accepting)).toThrow(
    'reject oversized',
  );
});

test('a broken bundle that rejects every valid identifier cannot pass the artifact check', () => {
  const rejecting: BoundedSdkSchema = {
    transform: (visit) => ({
      array: () => ({
        max: () => ({
          safeParse: (input) => {
            if (input.length === 1) input.forEach(visit);
            return { success: false };
          },
        }),
      }),
    }),
  };
  expect(() => assertBoundedSdkValidation(rejecting)).toThrow(
    'SDK validation healthy control failed',
  );
});

test('a bundle that skips valid identifier parsing cannot pass the healthy control', () => {
  const skipped: BoundedSdkSchema = {
    transform: () => ({
      array: () => ({
        max: () => ({ safeParse: (input) => ({ success: input.length <= 1 }) }),
      }),
    }),
  };
  expect(() => assertBoundedSdkValidation(skipped)).toThrow(
    'SDK validation healthy control failed',
  );
});
