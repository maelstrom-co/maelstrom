import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetSettingsStoreForTests,
  getSettingsSnapshot,
  settingsActions,
} from './settings.store';

beforeEach(__resetSettingsStoreForTests);

describe('settingsActions.adjustTextSize', () => {
  it('steps one size bigger and one size smaller', () => {
    expect(settingsActions.adjustTextSize('bigger')).toBe('large');
    expect(settingsActions.adjustTextSize('smaller')).toBe('medium');
    expect(settingsActions.adjustTextSize('smaller')).toBe('small');
  });

  it('stays at extra large when already at the biggest size', () => {
    settingsActions.setTextSize('extra-large');
    expect(settingsActions.adjustTextSize('bigger')).toBe('extra-large');
    expect(getSettingsSnapshot().textSize).toBe('extra-large');
  });

  it('stays at small when already at the smallest size', () => {
    settingsActions.setTextSize('small');
    expect(settingsActions.adjustTextSize('smaller')).toBe('small');
    expect(getSettingsSnapshot().textSize).toBe('small');
  });
});

describe('settingsActions.setVacationReply', () => {
  it('keeps the current message when none is given', () => {
    const before = getSettingsSnapshot().vacationReply.message;
    settingsActions.setVacationReply(true);
    expect(getSettingsSnapshot().vacationReply).toEqual({
      on: true,
      message: before,
    });
  });
});
