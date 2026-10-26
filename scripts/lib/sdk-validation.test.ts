import { expect, test } from 'bun:test';
import {
  assertBoundedSdkValidation,
  assertBundledValidationSources,
  type BoundedSdkSchema,
} from './sdk-validation.ts';

test('a stale client vendor runtime is rejected even when the protocol runtime is patched', () => {
  expect(() =>
    assertBundledValidationSources(
      ['var v={major:4,minor:6,patch:6}; inst._zod.version=v;'],
      'protocol',
    ),
  ).not.toThrow();
  expect(() =>
    assertBundledValidationSources(
      ['var v={major:4,minor:4,patch:3}; inst._zod.version=v;'],
      'client',
    ),
  ).toThrow('client: bundles vulnerable');
});

test('the last vulnerable patch is rejected at the boundary of the security fix', () => {
  expect(() =>
    assertBundledValidationSources(
      ['var v={major:4,minor:6,patch:5}; inst._zod.version=v;'],
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
        'var version = {major:4,minor:6,patch:6}; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('an unrelated patched tuple cannot identify a validator in the same file', () => {
  expect(() =>
    assertBundledValidationSources(
      ['var _zod=unknownRuntime; var unrelated={major:4,minor:6,patch:6};'],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('the version must come from the identifier assigned to Zod metadata', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var unrelated={major:4,minor:6,patch:6}; inst._zod.version=unknownVersion;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a parameter cannot borrow the version of an outer variable with the same name', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; function setup(version){inst._zod.version=version;}',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('unrelated version objects do not override the validator in its own lexical scope', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:4,patch:3}; function setup(){var version={major:4,minor:6,patch:6};inst._zod.version=version;}',
      ],
      'client',
    ),
  ).not.toThrow();
});

test('commented-out assignments cannot attest an unidentified runtime', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var _zod=unknownRuntime; // var v={major:4,minor:6,patch:6}; inst._zod.version=v;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a reassigned version binding cannot attest its original literal', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; version=unknownVersion; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a mutated version object cannot attest its original literal', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; version.patch=3; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('destructuring cannot change the version object before its metadata assignment', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; ({patch:version.patch}={patch:3}); inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('parenthesized mutation targets cannot keep the original version attestation', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; (version).patch=3; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a version object cannot escape through another binding before validation', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; var alias=version; alias.patch=3; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a shorthand property cannot hide an alias of the version object', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; var holder={version}; holder.version.patch=3; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a named export cannot expose the version binding outside metadata initialization', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; export {version}; inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('a version object passed to unknown code cannot attest its original literal', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; change(version); inst._zod.version=version;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('metadata cannot be changed through the instance after its version assignment', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; inst._zod.version=version; inst._zod.version.patch=3;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('metadata cannot escape through the instance after its version assignment', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; inst._zod.version=version; var alias=inst._zod.version; alias.patch=3;',
      ],
      'client',
    ),
  ).toThrow('could not be verified');
});

test('static bracket properties identify the same metadata as dot properties', () => {
  expect(() =>
    assertBundledValidationSources(
      [
        'var version={major:4,minor:6,patch:6}; inst["_zod"]["version"]=version;',
      ],
      'client',
    ),
  ).not.toThrow();
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
