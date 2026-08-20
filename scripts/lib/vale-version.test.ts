import { describe, expect, it } from 'bun:test';
import { assertValeVersion } from './vale-version.ts';

describe('assertValeVersion', () => {
  it('keeps local prose checks on the same Vale release as CI', () => {
    expect(() => assertValeVersion('vale version 3.18.0\n')).not.toThrow();
    expect(() => assertValeVersion('vale version 3.17.1')).toThrow(
      'Expected vale version 3.18.0, received vale version 3.17.1.',
    );
  });
});
