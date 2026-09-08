import { describe, expect, test } from 'vitest';

import {
  isSeededReplay,
  type SeededAction,
  scoreTrial,
  type TrialObservation,
} from './resize-replay-verdict';

const observation = (
  overrides: Partial<TrialObservation> = {},
): TrialObservation => ({
  plan: overrides.plan ?? [],
  refused: overrides.refused ?? [],
});

const journalSeed: SeededAction = {
  instanceId: 'journal-main',
  action: 'createEntry',
  params: { title: 'Morning pages' },
};

describe('isSeededReplay', () => {
  test('an empty response is not a hit', () => {
    expect(isSeededReplay(observation())).toBe(false);
  });

  test('the seeded action is a hit when it survived into the plan', () => {
    expect(
      isSeededReplay(
        observation({
          plan: [
            {
              instanceId: 'tasks-main',
              action: 'addTask',
              params: { title: 'Buy milk' },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test('the seeded action is a hit when the guard refused it', () => {
    // The refused side carries no params, so identity is the whole match.
    expect(
      isSeededReplay(
        observation({
          refused: [
            {
              reason: 'non_idempotent_on_resize',
              instanceId: 'tasks-main',
              action: 'addTask',
              vesselId: 'tasks',
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test('a sanctioned transition on a newly declared instance is not a hit', () => {
    // Reshaping the chart is what a resize turn is for; counting it would
    // score correct behaviour as the defect.
    expect(
      isSeededReplay(
        observation({
          plan: [{ instanceId: 'calendar-1', action: 'showWeek' }],
        }),
      ),
    ).toBe(false);
  });

  test.each([
    { reason: 'self_transition_noop', action: 'showList' },
    { reason: 'action_not_valid', action: 'renameList' },
  ])('a lone $reason skip is not a hit', ({ reason, action }) => {
    // `skippedActions` counts eleven unrelated reasons; only the seeded
    // identity says the model replayed.
    expect(
      isSeededReplay(
        observation({
          refused: [
            { reason, instanceId: 'tasks-main', action, vesselId: 'tasks' },
          ],
        }),
      ),
    ).toBe(false);
  });

  test('a different action carrying the seeded params is not a hit', () => {
    expect(
      isSeededReplay(
        observation({
          plan: [
            {
              instanceId: 'tasks-main',
              action: 'checkTask',
              params: { title: 'Buy milk' },
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  test('a supplied seed replaces the default identity', () => {
    expect(
      isSeededReplay(
        observation({
          plan: [
            {
              instanceId: 'journal-main',
              action: 'createEntry',
              params: { title: 'Morning pages' },
            },
          ],
        }),
        journalSeed,
      ),
    ).toBe(true);
  });

  test('a supplied seed does not match the default action', () => {
    expect(
      isSeededReplay(
        observation({
          plan: [
            {
              instanceId: 'tasks-main',
              action: 'addTask',
              params: { title: 'Buy milk' },
            },
          ],
        }),
        journalSeed,
      ),
    ).toBe(false);
  });

  test('the default seed still scores when no seed is supplied', () => {
    expect(
      isSeededReplay(
        observation({
          plan: [
            {
              instanceId: 'journal-main',
              action: 'createEntry',
              params: { title: 'Morning pages' },
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  test('the seeded action carrying different params is not a hit', () => {
    expect(
      isSeededReplay(
        observation({
          plan: [
            {
              instanceId: 'tasks-main',
              action: 'addTask',
              params: { title: 'Buy eggs' },
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe('scoreTrial', () => {
  test('separates the replay from everything else the model emitted', () => {
    const verdict = scoreTrial(
      observation({
        plan: [
          {
            instanceId: 'tasks-main',
            action: 'addTask',
            params: { title: 'Buy milk' },
          },
          { instanceId: 'calendar-1', action: 'showWeek' },
        ],
        refused: [
          {
            reason: 'self_transition_noop',
            instanceId: 'tasks-main',
            action: 'showList',
            vesselId: 'tasks',
          },
        ],
      }),
    );

    expect(verdict.survived).toBe(true);
    expect(verdict.refused).toBe(false);
    expect(verdict.otherActions).toEqual([
      'calendar-1.showWeek({})',
      'tasks-main.showList refused:self_transition_noop',
    ]);
  });

  test('scores a supplied seed on both sides of the guard', () => {
    const verdict = scoreTrial(
      observation({
        plan: [{ instanceId: 'journal-main', action: 'backToList' }],
        refused: [
          {
            reason: 'non_idempotent_on_resize',
            instanceId: 'journal-main',
            action: 'createEntry',
            vesselId: 'journal',
          },
        ],
      }),
      journalSeed,
    );

    expect(verdict.survived).toBe(false);
    expect(verdict.refused).toBe(true);
    expect(verdict.otherActions).toEqual(['journal-main.backToList({})']);
  });

  test('records a refused replay on the refused side', () => {
    const verdict = scoreTrial(
      observation({
        refused: [
          {
            reason: 'non_idempotent_on_resize',
            instanceId: 'tasks-main',
            action: 'addTask',
            vesselId: 'tasks',
          },
        ],
      }),
    );

    expect(verdict.survived).toBe(false);
    expect(verdict.refused).toBe(true);
    expect(verdict.otherActions).toEqual([]);
  });
});
