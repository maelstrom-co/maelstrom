import { describe, expect, test } from 'bun:test';
import { InstanceId, VariantName } from '@maelstrom-co/protocol';

import { createSimulationState } from './validation-context.js';

describe('createSimulationState', () => {
  test('seeds the underlying Map from the iterable', () => {
    const { reader } = createSimulationState([
      [InstanceId('a'), VariantName('x')],
    ]);
    expect(reader.variants.get(InstanceId('a'))).toBe(VariantName('x'));
    expect(reader.variants.size).toBe(1);
  });

  test('writer mutations are visible through the reader', () => {
    const { reader, writer } = createSimulationState([]);
    writer.variants.set(InstanceId('b'), VariantName('y'));
    expect(reader.variants.get(InstanceId('b'))).toBe(VariantName('y'));
  });

  test('accepts an empty iterable', () => {
    const { reader } = createSimulationState([]);
    expect(reader.variants.size).toBe(0);
  });
});
