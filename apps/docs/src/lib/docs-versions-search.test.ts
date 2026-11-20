import { expect, test } from 'bun:test';

import { searchFilterVersions, searchVersion } from './docs-versions';

const versions = ['dev', '0.3', '0.2'];

test('search on a versioned page stays in that version', () => {
  expect(searchVersion('/0.2/guides/react/setup/', versions, '0.3')).toBe(
    '0.2',
  );
  expect(searchVersion('/dev/', versions, '0.3')).toBe('dev');
});

test('search on an unversioned page uses the default version', () => {
  expect(searchVersion('/agents/skills/', versions, '0.3')).toBe('0.3');
  expect(searchVersion('/', versions, '0.3')).toBe('0.3');
});

test('a folder name that only looks like a version is not one', () => {
  expect(searchVersion('/0.1/guides/', versions, '0.3')).toBe('0.3');
});

test('a versioned page is indexed under its own version only', () => {
  expect(searchFilterVersions('/0.2/guides/react/setup/', versions)).toEqual([
    '0.2',
  ]);
});

test('an unversioned page is indexed under every version', () => {
  expect(
    searchFilterVersions('/understanding/architecture/', versions),
  ).toEqual(versions);
});
