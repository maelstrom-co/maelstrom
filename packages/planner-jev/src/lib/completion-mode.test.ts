import { describe, expect, test } from 'bun:test';

import { completionMode } from './completion-mode.js';

describe('completionMode without skipReply', () => {
  for (const skipReply of [undefined, false]) {
    for (const slotCount of [0, 2]) {
      for (const layoutHandOff of [false, true]) {
        test(`is full for skipReply ${skipReply}, ${slotCount} slots, hand-off ${layoutHandOff}`, () => {
          expect(completionMode({ skipReply, slotCount, layoutHandOff })).toBe(
            'full',
          );
        });
      }
    }
  }
});

describe('completionMode with skipReply', () => {
  test('skips when no slots are pending and layout did not hand off', () => {
    expect(
      completionMode({ skipReply: true, slotCount: 0, layoutHandOff: false }),
    ).toBe('skip');
  });

  test('is replyless when slots are pending', () => {
    expect(
      completionMode({ skipReply: true, slotCount: 1, layoutHandOff: false }),
    ).toBe('replyless');
  });

  test('is replyless when layout handed off', () => {
    expect(
      completionMode({ skipReply: true, slotCount: 0, layoutHandOff: true }),
    ).toBe('replyless');
  });

  test('is replyless when slots are pending and layout handed off', () => {
    expect(
      completionMode({ skipReply: true, slotCount: 3, layoutHandOff: true }),
    ).toBe('replyless');
  });
});
