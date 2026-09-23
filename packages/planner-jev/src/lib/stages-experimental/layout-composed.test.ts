import { describe, expect, test } from 'bun:test';

import { type ChartRequest, isErr, isOk, ok } from '@maelstrom-co/protocol';

import { makeContext, makeRequest } from '../__test-helpers__/fixtures.js';
import { actionPlan } from '../__test-helpers__/layout-fixtures.js';
import {
  buildReply,
  type Payload,
  type Step,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import type { SelectionDecision } from '../types.js';
import type { Ask } from '../typesafe-client.js';
import {
  type ComposedLayoutDecision,
  KEEP_ARRANGEMENT_NO_NEW_NOTE,
  KEEP_ARRANGEMENT_NOTE,
  type LayoutComposedOptions,
  layoutComposed,
} from './layout-composed.js';
import type { GateAnswer, GatedActionPlan } from './types.js';

const FIVE_IN_A_ROW = [
  'V:1,1,1,1,1',
  'ID:calendar-main',
  'ID:tasks-main',
  'ID:map-main',
  'ID:weather-main',
  'ID:journal-main',
];

const WORKED_EXAMPLE_INTENT =
  'Put the calendar and tasks in a narrow column on the left. On the right, stack the map, weather and journal, and give the journal half the height.';

const WORKED_EXAMPLE_STEP: Step = {
  choices: {
    shape: 'side_by_side_2',
    'placement/calendar-main': 'part_1',
    'placement/tasks-main': 'part_1',
    'placement/map-main': 'part_2',
    'placement/weather-main': 'part_2',
    'placement/journal-main': 'part_2',
    'position/calendar-main': 'first',
    'position/tasks-main': 'second',
    'position/map-main': 'first',
    'position/weather-main': 'second',
    'position/journal-main': 'third',
  },
  scores: {
    'size/calendar-main': 1,
    'size/tasks-main': 1,
    'size/map-main': 2,
    'size/weather-main': 2,
    'size/journal-main': 4,
  },
  confidence: 0.8,
};

function gate(answer: 'yes' | 'no'): GateAnswer {
  return { answer, probability: answer === 'yes' ? 0.9 : 0.1, confidence: 0.8 };
}

function gatedPlan(
  request: ChartRequest,
  spatial: 'yes' | 'no',
  decisions: Readonly<Record<string, SelectionDecision>> = {},
): GatedActionPlan {
  return {
    ...actionPlan(request, [], decisions),
    minConfidence: 1,
    gates: {
      needsActions: gate('no'),
      generatedContent: gate('no'),
      spatial: gate(spatial),
    },
  };
}

async function run(
  plan: GatedActionPlan,
  step: Step | ((payload: Payload) => Step),
  options: LayoutComposedOptions & {
    readonly distributions?: Readonly<Record<string, Record<string, number>>>;
  } = {},
) {
  const scripted = scriptedAsk((payload) =>
    typeof step === 'function' ? step(payload) : step,
  );
  const ask = options.distributions
    ? withDistributions(scripted.ask, options.distributions)
    : scripted.ask;
  const result = await layoutComposed(ask, options)(
    plan,
    makeContext(plan.selection.input),
  );
  return { result, calls: scripted.calls };
}

/**
 * Puts full per-option distributions on the named choice answers, as a
 * reply that keeps choice probabilities carries them.
 */
function withDistributions(
  ask: Ask,
  distributions: Readonly<Record<string, Record<string, number>>>,
): Ask {
  return async (stage, evaluation, ctx) => {
    const reply = await ask(stage, evaluation, ctx);
    if (isErr(reply)) return reply;
    const answers = { ...reply.value.answers };
    for (const [id, probabilities] of Object.entries(distributions)) {
      const answer = answers[id];
      if (answer) answers[id] = { ...answer, probabilities };
    }
    return ok({ ...reply.value, answers });
  };
}

function decisionOf<T>(result: { readonly ok: boolean } & object): T {
  if (!isOk(result as never)) throw new Error('expected a layout');
  return (result as unknown as { value: T }).value;
}

/** Every Instance of the default board in its own stacked part, in board order. */
const STACKED_THREE: Step = {
  choices: {
    shape: 'stacked_3',
    'placement/calendar-main': 'part_1',
    'placement/weather-main': 'part_2',
    'placement/tasks-main': 'part_3',
  },
  scores: {
    'size/calendar-main': 2,
    'size/weather-main': 2,
    'size/tasks-main': 2,
  },
};

describe('layoutComposed', () => {
  test('the worked example assembles exactly its tree in one call', async () => {
    const plan = gatedPlan(
      makeRequest(WORKED_EXAMPLE_INTENT, { tree: FIVE_IN_A_ROW }),
      'yes',
    );
    const { result, calls } = await run(plan, WORKED_EXAMPLE_STEP);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]?.questions ?? {})).toHaveLength(16);
    if (!isOk(result)) throw new Error('expected a layout');
    expect(result.value.source).toBe('jev');
    expect(result.value.plan).toBe(plan);
    expect(result.value.tree).toEqual([
      'V:1,4',
      'H',
      'ID:calendar-main',
      'ID:tasks-main',
      'H:1,1,2',
      'ID:map-main',
      'ID:weather-main',
      'ID:journal-main',
    ]);
  });

  test('records every option probability the TypeSafe client keeps on a choice answer', async () => {
    const plan = gatedPlan(makeRequest('stack them'), 'yes');
    const { result } = await run(plan, STACKED_THREE);
    const { composition } = decisionOf<ComposedLayoutDecision>(result);
    expect(Object.keys(composition.answers?.shape.probabilities ?? {})).toEqual(
      [
        'side_by_side_2',
        'side_by_side_3',
        'side_by_side_4',
        'stacked_2',
        'stacked_3',
        'stacked_4',
        'more_than_4_parts',
        'split_inside_nested_part',
      ],
    );
    expect(
      Object.keys(
        composition.answers?.placements['calendar-main']?.probabilities ?? {},
      ),
    ).toEqual(['part_1', 'part_2', 'part_3', 'part_4']);
  });

  test('asks 3n + 1 questions: shape, then part, position and size per Instance', async () => {
    const plan = gatedPlan(makeRequest('stack them'), 'yes');
    const { calls } = await run(plan, STACKED_THREE);
    const questions = calls[0]?.questions ?? {};
    expect(Object.keys(questions)).toEqual([
      'shape',
      'placement/calendar-main',
      'position/calendar-main',
      'size/calendar-main',
      'placement/weather-main',
      'position/weather-main',
      'size/weather-main',
      'placement/tasks-main',
      'position/tasks-main',
      'size/tasks-main',
    ]);
    expect(Object.keys(questions.shape?.criteria ?? {})).toEqual([
      'side_by_side_2',
      'side_by_side_3',
      'side_by_side_4',
      'stacked_2',
      'stacked_3',
      'stacked_4',
      'more_than_4_parts',
      'split_inside_nested_part',
    ]);
    expect(
      Object.keys(questions['position/calendar-main']?.criteria ?? {}),
    ).toEqual(['first', 'second', 'third']);
    expect(
      Object.values(questions['size/calendar-main']?.criteria ?? {}),
    ).toEqual([
      'tiny: as small as it can be',
      'small',
      'medium',
      'large',
      'very large: the biggest widget on the chart',
    ]);
    const wording = JSON.stringify(questions).toLowerCase();
    for (const banned of ['row', 'column', 'left-right', 'top-bottom'])
      expect(wording).not.toContain(banned);
  });

  test('records every answer, as answer records and by question kind', async () => {
    const plan = gatedPlan(
      makeRequest(WORKED_EXAMPLE_INTENT, { tree: FIVE_IN_A_ROW }),
      'yes',
    );
    const { result } = await run(plan, WORKED_EXAMPLE_STEP);
    const value = decisionOf<{
      answers: readonly { question: string; choice: string }[];
      composition: {
        route: string;
        called: boolean;
        nudged: boolean;
        answers: {
          shape: { choice: string };
          placements: Record<string, { choice: string }>;
          positions: Record<string, { choice: string }>;
          sizes: Record<string, { level: string; size: number }>;
        };
        chosen: number;
        candidates: readonly { droppedParts: unknown[] }[];
      };
    }>(result);
    expect(value.answers).toHaveLength(16);
    expect(value.answers).toContainEqual(
      expect.objectContaining({ question: 'shape', choice: 'side_by_side_2' }),
    );
    expect(value.answers).toContainEqual(
      expect.objectContaining({ question: 'size/journal-main', choice: '4' }),
    );
    const { composition } = value;
    expect(composition).toMatchObject({
      route: 'spatial',
      called: true,
      nudged: false,
      chosen: 0,
    });
    expect(composition.answers.shape.choice).toBe('side_by_side_2');
    expect(composition.answers.placements['map-main']?.choice).toBe('part_2');
    expect(composition.answers.positions['journal-main']?.choice).toBe('third');
    expect(composition.answers.sizes['map-main']).toMatchObject({
      level: '2',
      size: 0.5,
    });
    expect(composition.candidates[0]?.droppedParts).toEqual([]);
  });

  test('drops a shape part nobody was placed in and records the repair', async () => {
    const plan = gatedPlan(makeRequest('weather apart from the rest'), 'yes');
    const { result } = await run(plan, {
      ...STACKED_THREE,
      choices: {
        shape: 'side_by_side_3',
        'placement/calendar-main': 'part_1',
        'placement/weather-main': 'part_3',
        'placement/tasks-main': 'part_1',
        'position/tasks-main': 'second',
      },
    });
    const value = decisionOf<{
      tree: unknown;
      composition: { candidates: readonly { droppedParts: unknown }[] };
    }>(result);
    expect(value.tree).toEqual([
      'V:2,1',
      'H',
      'ID:calendar-main',
      'ID:tasks-main',
      'ID:weather-main',
    ]);
    expect(value.composition.candidates[0]?.droppedParts).toEqual(['part_2']);
  });

  test('returns the most probable candidate that fits, skipping one that does not', async () => {
    const plan = gatedPlan(
      makeRequest('one above the other', { columns: 12 }),
      'yes',
    );
    const { result } = await run(
      plan,
      {
        ...STACKED_THREE,
        choices: { ...STACKED_THREE.choices, shape: 'side_by_side_3' },
      },
      { distributions: { shape: { side_by_side_3: 0.7, stacked_3: 0.3 } } },
    );
    const value = decisionOf<{
      source: string;
      tree: unknown;
      composition: {
        chosen: number;
        candidates: readonly { tree: unknown; fits: boolean }[];
      };
    }>(result);
    expect(value.source).toBe('jev');
    expect(value.composition.candidates.map((c) => [c.tree, c.fits])).toEqual([
      [
        ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
        false,
      ],
      [
        ['H:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
        true,
      ],
    ]);
    expect(value.composition.chosen).toBe(1);
    expect(value.tree).toEqual(value.composition.candidates[1]?.tree);
  });

  test('hands off without a tree when no candidate fits', async () => {
    const plan = gatedPlan(makeRequest('side by side', { columns: 12 }), 'yes');
    const { result } = await run(plan, {
      ...STACKED_THREE,
      choices: { ...STACKED_THREE.choices, shape: 'side_by_side_3' },
    });
    const value = decisionOf<{
      source: string;
      tree?: unknown;
      answers: readonly unknown[];
      composition: {
        handOff: string;
        candidates: readonly { fits: boolean }[];
      };
    }>(result);
    expect(value.source).toBe('llm');
    expect(value.tree).toBeUndefined();
    expect(value.answers).toHaveLength(10);
    expect(value.composition.handOff).toBe('nothing_fits');
    expect(value.composition.candidates.map((c) => c.fits)).toEqual([false]);
  });

  for (const shape of ['more_than_4_parts', 'split_inside_nested_part'])
    test(`hands off when the shape answer is ${shape}`, async () => {
      const plan = gatedPlan(makeRequest('a complicated arrangement'), 'yes');
      const { result } = await run(plan, {
        ...STACKED_THREE,
        choices: { ...STACKED_THREE.choices, shape },
      });
      const value = decisionOf<{
        source: string;
        tree?: unknown;
        answers: readonly unknown[];
        composition: { handOff: string; candidates: readonly unknown[] };
      }>(result);
      expect(value.source).toBe('llm');
      expect(value.tree).toBeUndefined();
      expect(value.answers).toHaveLength(10);
      expect(value.composition).toMatchObject({
        handOff: shape,
        candidates: [],
      });
    });

  test('the 2-level size scale reads the size as the upper level probability', async () => {
    const plan = gatedPlan(
      makeRequest('narrow calendar on the left', {
        tree: ['V', 'ID:calendar-main', 'ID:map-main'],
      }),
      'yes',
    );
    const upper: Record<string, number> = {
      'size/calendar-main': 0.2,
      'size/map-main': 0.8,
    };
    const { result, calls } = await run(
      plan,
      (payload) => {
        const reply = buildReply(payload, {
          shape: 'side_by_side_2',
          'placement/calendar-main': 'part_1',
          'placement/map-main': 'part_2',
        });
        for (const [id, probability] of Object.entries(upper))
          reply.answers[id] = {
            ...(reply.answers[id] as object),
            score: probability,
            probabilities: { '0': 1 - probability, '1': probability },
          } as never;
        return { reply };
      },
      { sizeLevels: 2 },
    );
    expect(
      Object.values(calls[0]?.questions['size/map-main']?.criteria ?? {}),
    ).toEqual(['as small as possible', 'as large as possible']);
    const value = decisionOf<{
      tree: unknown;
      composition: {
        sizeLevels: number;
        answers: { sizes: Record<string, { size: number }> };
      };
    }>(result);
    expect(value.composition.sizeLevels).toBe(2);
    expect(value.composition.answers.sizes['map-main']?.size).toBe(0.8);
    expect(value.tree).toEqual(['V:1,4', 'ID:calendar-main', 'ID:map-main']);
  });

  describe('gating on the spatial answer', () => {
    test('no stated arrangement and the same Instances keeps a fitting current tree without a call', async () => {
      const request = makeRequest('open the calendar');
      const plan = gatedPlan(request, 'no');
      const { result, calls } = await run(plan, STACKED_THREE);
      expect(calls).toHaveLength(0);
      const value = decisionOf<{
        source: string;
        tree: unknown;
        composition: { route: string; called: boolean };
      }>(result);
      expect(value.source).toBe('preserve');
      expect(value.tree).toEqual(
        request.layout.type === 'tiling' ? request.layout.tree : [],
      );
      expect(value.composition).toMatchObject({
        route: 'same_instances',
        called: false,
      });
    });

    test('no stated arrangement and the same Instances composes with the nudge when the current tree does not fit', async () => {
      const plan = gatedPlan(
        makeRequest('open the calendar', { columns: 12 }),
        'no',
      );
      const { result, calls } = await run(plan, STACKED_THREE);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.state).toMatchObject({
        currentArrangement:
          'calendar-main on the left; weather-main in the middle; tasks-main on the right',
        arrangementNote: KEEP_ARRANGEMENT_NO_NEW_NOTE,
      });
      const value = decisionOf<{
        source: string;
        composition: { route: string; nudged: boolean };
      }>(result);
      expect(value.source).toBe('jev');
      expect(value.composition).toMatchObject({
        route: 'same_instances',
        nudged: true,
      });
    });

    test('no stated arrangement with an added Instance composes with the current arrangement and the keep note', async () => {
      const plan = gatedPlan(makeRequest('show the map'), 'no', {
        'map-main': 'keep',
      });
      const { result, calls } = await run(plan, {
        choices: {
          shape: 'side_by_side_4',
          'placement/weather-main': 'part_2',
          'placement/tasks-main': 'part_3',
          'placement/map-main': 'part_4',
        },
        scores: {},
      });
      expect(calls).toHaveLength(1);
      expect(Object.keys(calls[0]?.questions ?? {})).toHaveLength(13);
      expect(calls[0]?.state).toMatchObject({
        currentArrangement:
          'calendar-main on the left; weather-main in the middle; tasks-main on the right',
        arrangementNote: KEEP_ARRANGEMENT_NOTE,
        newInstances: ['map-main'],
      });
      expect(KEEP_ARRANGEMENT_NOTE).toBe(
        'The user did not ask to change the arrangement. Keep the other Instances where they are. Put the new Instance where it fits best.',
      );
      const value = decisionOf<{
        tree: unknown;
        composition: { route: string; nudged: boolean };
      }>(result);
      expect(value.tree).toEqual([
        'V:1,1,1,1',
        'ID:calendar-main',
        'ID:weather-main',
        'ID:tasks-main',
        'ID:map-main',
      ]);
      expect(value.composition).toMatchObject({
        route: 'instances_changed',
        nudged: true,
      });
    });

    test('no stated arrangement with a removed Instance composes with the nudge', async () => {
      const plan = gatedPlan(makeRequest('remove the tasks'), 'no', {
        'tasks-main': 'delete',
      });
      const { result, calls } = await run(plan, {
        choices: {
          shape: 'side_by_side_2',
          'placement/weather-main': 'part_2',
        },
      });
      expect(calls[0]?.state).toMatchObject({
        arrangementNote: KEEP_ARRANGEMENT_NO_NEW_NOTE,
      });
      expect(calls[0]?.state).not.toHaveProperty('newInstances');
      expect(
        decisionOf<{ composition: { route: string } }>(result).composition
          .route,
      ).toBe('instances_changed');
    });

    test('a stated arrangement composes without the nudge', async () => {
      const plan = gatedPlan(makeRequest('stack them'), 'yes');
      const { calls } = await run(plan, STACKED_THREE);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.state).not.toHaveProperty('currentArrangement');
      expect(calls[0]?.state).not.toHaveProperty('arrangementNote');
    });
  });

  test('a single visible Instance fills the Chart without a call', async () => {
    const plan = gatedPlan(makeRequest('only the calendar'), 'yes', {
      'weather-main': 'hide',
      'tasks-main': 'hide',
    });
    const { result, calls } = await run(plan, STACKED_THREE);
    expect(calls).toHaveLength(0);
    expect(decisionOf<{ tree: unknown; source: string }>(result)).toMatchObject(
      {
        source: 'jev',
        tree: ['ID:calendar-main'],
      },
    );
  });
});
