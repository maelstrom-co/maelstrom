import { describe, expect, test } from 'bun:test';

import { InstanceId } from '@maelstrom-co/protocol';

import {
  type CompositionAnswers,
  composeCandidates,
  type InstanceAnswers,
  integerWeights,
  sizeShares,
} from './layout-composed-tree.js';

function sure(option: string): Readonly<Record<string, number>> {
  return { [option]: 1 };
}

function instance(
  id: string,
  part: string,
  position: string,
  size: number,
): InstanceAnswers {
  return {
    instanceId: InstanceId(id),
    placement: sure(part),
    position: sure(position),
    size,
  };
}

const WORKED_EXAMPLE: CompositionAnswers = {
  shape: sure('side_by_side_2'),
  instances: [
    instance('calendar', 'part_1', 'first', 0.25),
    instance('tasks', 'part_1', 'second', 0.25),
    instance('map', 'part_2', 'first', 0.5),
    instance('weather', 'part_2', 'second', 0.5),
    instance('journal', 'part_2', 'third', 1),
  ],
};

describe('composeCandidates', () => {
  test('the worked example assembles exactly its tree', () => {
    const [candidate, ...rest] = composeCandidates(WORKED_EXAMPLE);
    expect(rest).toEqual([]);
    expect(candidate?.tree).toEqual([
      'V:1,4',
      'H',
      'ID:calendar',
      'ID:tasks',
      'H:1,1,2',
      'ID:map',
      'ID:weather',
      'ID:journal',
    ]);
    expect(candidate?.shares).toEqual({
      calendar: 0.1,
      tasks: 0.1,
      map: 0.2,
      weather: 0.2,
      journal: 0.4,
    });
    expect(candidate?.meanProbability).toBe(1);
  });

  test('a stacked shape nests a shared part side by side and leaves a lone Instance a leaf', () => {
    const [candidate] = composeCandidates({
      shape: sure('stacked_2'),
      instances: [
        instance('weather', 'part_1', 'first', 0.5),
        instance('calendar', 'part_2', 'first', 0.5),
        instance('tasks', 'part_2', 'second', 0.5),
      ],
    });
    expect(candidate?.tree).toEqual([
      'H:1,2',
      'ID:weather',
      'V',
      'ID:calendar',
      'ID:tasks',
    ]);
  });

  test('every Instance in its own part is a flat split', () => {
    const [candidate] = composeCandidates({
      shape: sure('side_by_side_3'),
      instances: [
        instance('a', 'part_3', 'first', 0.5),
        instance('b', 'part_1', 'first', 0.5),
        instance('c', 'part_2', 'first', 0.5),
      ],
    });
    expect(candidate?.tree).toEqual(['V:1,1,1', 'ID:b', 'ID:c', 'ID:a']);
  });

  test('positions order a part, and a tie goes to the more probable position', () => {
    const tied = (id: string, probability: number): InstanceAnswers => ({
      instanceId: InstanceId(id),
      placement: sure('part_1'),
      position: { second: probability, first: 1 - probability },
      size: 0.5,
    });
    const [candidate] = composeCandidates({
      shape: sure('side_by_side_2'),
      instances: [
        instance('last', 'part_1', 'third', 0.5),
        tied('unsure', 0.6),
        tied('sure', 0.9),
        instance('alone', 'part_2', 'first', 0.5),
      ],
    });
    expect(candidate?.positions).toMatchObject({
      unsure: 'second',
      sure: 'second',
    });
    expect(candidate?.tree).toEqual([
      'V:3,1',
      'H:1,1,1',
      'ID:sure',
      'ID:unsure',
      'ID:last',
      'ID:alone',
    ]);
  });

  test('a shape part nobody is placed in is dropped and reported', () => {
    const [candidate] = composeCandidates({
      shape: sure('side_by_side_3'),
      instances: [
        instance('a', 'part_1', 'first', 0.5),
        instance('b', 'part_3', 'first', 0.5),
      ],
    });
    expect(candidate?.tree).toEqual(['V', 'ID:a', 'ID:b']);
    expect(candidate?.droppedParts).toEqual(['part_2']);
    expect(candidate?.addedParts).toEqual([]);
  });

  test('a placement past the shape adds a part and is reported', () => {
    const [candidate] = composeCandidates({
      shape: sure('stacked_2'),
      instances: [
        instance('a', 'part_1', 'first', 0.5),
        instance('b', 'part_2', 'first', 0.5),
        instance('c', 'part_3', 'first', 0.5),
      ],
    });
    expect(candidate?.tree).toEqual(['H:1,1,1', 'ID:a', 'ID:b', 'ID:c']);
    expect(candidate?.addedParts).toEqual(['part_3']);
    expect(candidate?.droppedParts).toEqual([]);
  });

  test('keeps the three most probable distinct trees, most probable first', () => {
    const candidates = composeCandidates({
      shape: { side_by_side_2: 0.6, stacked_2: 0.4 },
      instances: [
        {
          instanceId: InstanceId('a'),
          placement: { part_1: 0.9, part_2: 0.1 },
          position: { first: 0.8, second: 0.2 },
          size: 0.5,
        },
        {
          instanceId: InstanceId('b'),
          placement: { part_2: 0.7, part_1: 0.3 },
          position: { first: 0.5, second: 0.5 },
          size: 0.5,
        },
      ],
    });
    expect(candidates.map((candidate) => candidate.tree)).toEqual([
      ['V', 'ID:a', 'ID:b'],
      ['H', 'ID:a', 'ID:b'],
      ['H', 'ID:b', 'ID:a'],
    ]);
    expect(candidates[0]?.meanProbability).toBeCloseTo(
      Math.cbrt(0.6 * 0.9 * 0.7),
    );
    const means = candidates.map((candidate) => candidate.meanProbability);
    expect([...means].sort((x, y) => y - x)).toEqual(means);
  });
});

describe('sizeShares', () => {
  test('normalises to shares summing to 1', () => {
    expect(sizeShares([0.25, 0.25, 0.5, 0.5, 1])).toEqual([
      0.1, 0.1, 0.2, 0.2, 0.4,
    ]);
  });

  test('raises a zero share to the floor and still sums to 1', () => {
    const shares = sizeShares([0, 1, 1]);
    expect(shares[0]).toBeGreaterThan(0);
    expect(shares[0]).toBeCloseTo(0.05 / 1.05);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });

  test('all sizes zero reads as equal shares', () => {
    expect(sizeShares([0, 0])).toEqual([0.5, 0.5]);
  });
});

describe('integerWeights', () => {
  test('writes shares as the smallest integer ratio', () => {
    expect(integerWeights([0.2, 0.8])).toEqual([1, 4]);
    expect(integerWeights([0.2, 0.2, 0.4])).toEqual([1, 1, 2]);
    expect(integerWeights([0.1, 0.1])).toEqual([1, 1]);
    expect(integerWeights([1 / 3, 2 / 3])).toEqual([1, 2]);
    expect(integerWeights([0.25, 0.75])).toEqual([1, 3]);
  });

  test('every weight is a positive integer', () => {
    const weights = integerWeights([0.01, 0.99]);
    expect(weights.every((w) => Number.isInteger(w) && w >= 1)).toBe(true);
  });
});
