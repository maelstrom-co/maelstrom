import { describe, expect, test } from 'bun:test';

import {
  CHANGE_SCREEN_GOAL_MAX_CHARS,
  CHANGE_SCREEN_REFERENTS_MAX_CHARS,
  CHANGE_SCREEN_TOOL_NAME,
  changeScreenInputSchema,
  changeScreenToolEntry,
} from './change-screen-tool.js';

describe('change_screen tool input', () => {
  test('accepts a plain goal with and without referents', () => {
    expect(
      changeScreenInputSchema.safeParse({ goal: 'show my last order' }).success,
    ).toBe(true);
    expect(
      changeScreenInputSchema.safeParse({
        goal: 'show order o-1',
        referents: { orderId: 'o-1', quantity: 2 },
      }).success,
    ).toBe(true);
  });

  test('refuses a blank goal and a goal over 500 characters', () => {
    expect(CHANGE_SCREEN_GOAL_MAX_CHARS).toBe(500);
    expect(changeScreenInputSchema.safeParse({ goal: '   ' }).success).toBe(
      false,
    );
    expect(
      changeScreenInputSchema.safeParse({ goal: 'g'.repeat(500) }).success,
    ).toBe(true);
    expect(
      changeScreenInputSchema.safeParse({ goal: 'g'.repeat(501) }).success,
    ).toBe(false);
  });

  test('refuses referents whose serialized form is over 2,000 characters', () => {
    expect(CHANGE_SCREEN_REFERENTS_MAX_CHARS).toBe(2_000);
    const fits = { note: 'r'.repeat(2_000 - '{"note":""}'.length) };
    expect(JSON.stringify(fits).length).toBe(2_000);
    expect(
      changeScreenInputSchema.safeParse({ goal: 'g', referents: fits }).success,
    ).toBe(true);
    expect(
      changeScreenInputSchema.safeParse({
        goal: 'g',
        referents: { note: `${fits.note}r` },
      }).success,
    ).toBe(false);
  });

  test('refuses referents that are not a JSON object', () => {
    expect(
      changeScreenInputSchema.safeParse({ goal: 'g', referents: ['o-1'] })
        .success,
    ).toBe(false);
  });

  test('hides the internal mode from the model-facing schema', () => {
    const parsed = changeScreenInputSchema.safeParse({
      goal: 'g',
      mode: 'ambient',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('mode');
  });

  test('is an idempotent built-in named change_screen whose description asks for a plain goal and the result', () => {
    expect(CHANGE_SCREEN_TOOL_NAME).toBe('change_screen');
    expect(changeScreenToolEntry.tool.name).toBe('change_screen');
    expect(changeScreenToolEntry.sideEffect).toBe('idempotent');
    const description = changeScreenToolEntry.tool.description;
    expect(description).toContain('goal');
    expect(description).toContain('referents');
    expect(description).toContain('Vessel');
    expect(description).toContain('wait');
    expect(description).toMatch(/goal itself must contain the exact values/);
    expect(description).toMatch(/Vessel ids are only for describe_capabilities/);
  });
});
