import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { transitionDataSchema } from '../../packages/evals/src/adapters/legacy-vessel-transition.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { loadOfflineCases } from './cases.js';
import {
  legacyVesselTransition,
  type VesselTransitionTurn,
} from './vessel-transition-fixture.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in transition controls');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

const identity = {
  runId: 'transition-controls',
  caseId: 'case',
  runtimeId: 'scripted',
  sample: 1,
};

function adapter(id: string) {
  const item = loadOfflineCases().find((item) => item.definition.id === id);
  if (!item || item.definition.profile !== 'legacy-vessel-transition')
    throw new Error('Missing transition case');
  const data = transitionDataSchema.parse(item.fixture.data);
  const other = { ...data.instances[0], instanceId: 'unrelated-instance' };
  data.instances.push(other);
  return legacyVesselTransition(
    data,
    item.definition.inputs,
    item.definition.expectations,
  );
}

test('transition oracle catches broken response/retained state with independent output mutations', async () => {
  for (const id of ['calendar-week', 'weather-hourly', 'labs-upload']) {
    const subject = adapter(id);
    const positive = await evaluateSample({ ...identity, caseId: id }, subject);
    expect(positive.evaluation).toBe('pass');
    const turns = positive.observation;
    if (!turns) throw new Error('Missing completed turn evidence');
    expect(turns[0].resultingState.instances[1]).toEqual(
      turns[0].state.instances[1],
    );
    const mutations: ((turn: VesselTransitionTurn) => VesselTransitionTurn)[] =
      [
        (turn) => ({ ...turn, output: { ...turn.output, executionPlan: [] } }),
        (turn) => ({
          ...turn,
          output: {
            ...turn.output,
            executionPlan: [
              { ...turn.output.executionPlan[0], action: 'invented' },
            ],
          },
        }),
        (turn) => ({
          ...turn,
          output: {
            ...turn.output,
            executionPlan: [
              {
                ...turn.output.executionPlan[0],
                instanceId: 'unrelated-instance',
              },
            ],
          },
        }),
        (turn) => ({
          ...turn,
          output: {
            ...turn.output,
            executionPlan: [
              ...turn.output.executionPlan,
              ...turn.output.executionPlan,
            ],
          },
        }),
        (turn) => ({
          ...turn,
          output: { ...turn.output, instances: turn.state.instances },
        }),
        (turn) => ({ ...turn, resultingState: turn.state }),
        (turn) => ({
          ...turn,
          resultingState: {
            instances: turn.resultingState.instances.map((item, i) =>
              i === 0 ? { ...item, instanceId: 'replaced-target' } : item,
            ),
          },
        }),
        (turn) => ({
          ...turn,
          output: {
            ...turn.output,
            instances: turn.output.instances.map((item, i) =>
              i === 0
                ? {
                    ...item,
                    vesselId:
                      item.vesselId === 'weather' ? 'calendar' : 'weather',
                  }
                : item,
            ),
          },
        }),
        (turn) => ({
          ...turn,
          resultingState: { instances: [turn.resultingState.instances[0]] },
        }),
        (turn) => ({
          ...turn,
          resultingState: {
            instances: turn.resultingState.instances.map((item, i) =>
              i === 1 ? { ...item, variant: 'changed-unrelated' } : item,
            ),
          },
        }),
        (turn) => ({
          ...turn,
          output: {
            ...turn.output,
            instances: [turn.output.instances[0], turn.output.instances[0]],
          },
        }),
      ];
    for (const mutate of mutations) {
      const broken = await evaluateSample(identity, {
        ...subject,
        execute: async () => ({
          completeness: 'complete',
          disposition: 'planned',
          value: [mutate(structuredClone(turns[0]))],
        }),
      });
      expect(broken.execution).toBe('completed');
      expect(broken.evaluation).toBe('fail');
      expect(broken.failures.length).toBeGreaterThan(0);
    }
    expect(subject.score([]).outcome).toBe('fail');
    const equivalent = structuredClone(turns[0]);
    const reordered = {
      ...equivalent,
      output: {
        ...equivalent.output,
        instances: [...equivalent.output.instances].reverse(),
      },
      resultingState: {
        instances: [...equivalent.resultingState.instances].reverse(),
      },
    };
    expect(subject.score([reordered]).outcome).toBe('pass');
    for (const completeness of ['partial', 'absent'] as const) {
      const missing = await evaluateSample(identity, {
        ...subject,
        execute: async () => ({
          completeness,
          disposition: 'planned',
          value: turns,
        }),
        score: () => {
          throw new Error('Must not score incomplete evidence');
        },
      });
      expect(missing.evaluation).toBe('unscored');
      expect(missing.error).toBeUndefined();
    }
    const repeated = await evaluateSample({ ...identity, sample: 2 }, subject);
    expect(repeated.evaluation).toBe('pass');
    expect(repeated.observation).toEqual(turns);
  }
});
