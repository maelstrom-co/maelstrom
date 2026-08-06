import { expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as testingApi from './_testing.js';
import { warnOnce } from './lib/warn-once.js';

test('keeps warning helpers off the root and exposes only reset through _testing', () => {
  const rootSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  expect(rootSource).not.toMatch(/\bwarnOnce\b/);
  expect(rootSource).not.toMatch(/\bresetWarnings\b/);
  expect(Object.keys(testingApi)).toEqual(['resetWarnings']);
});

test('resetWarnings is an empty-state no-op and permits a key to warn again', () => {
  testingApi.resetWarnings();
  const warn = spyOn(console, 'warn').mockImplementation(() => {});

  try {
    warnOnce('public-api-test', 'disabled', { enabled: false });
    expect(warn).not.toHaveBeenCalled();

    warnOnce('public-api-test', 'first');
    warnOnce('public-api-test', 'duplicate');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith('first');

    testingApi.resetWarnings();
    warnOnce('public-api-test', 'after reset');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith('after reset');
  } finally {
    warn.mockRestore();
    testingApi.resetWarnings();
  }
});
