import { describe, expect, test } from 'bun:test';
import { InstanceId } from '@maelstrom-co/protocol';

import { buildGridLayout } from './build-grid-layout.js';

describe('buildGridLayout', () => {
  test('attaches `type: "grid"` discriminator and passes positions through', () => {
    const positions = [
      {
        instanceId: InstanceId('a'),
        position: { row: 0, column: 0 },
        size: { width: 1, height: 1 },
      },
    ];
    const result = buildGridLayout({ positions });
    expect(result.type).toBe('grid');
    expect(result.positions).toBe(positions); // same reference
  });

  test('accepts an empty positions array', () => {
    const result = buildGridLayout({ positions: [] });
    expect(result.type).toBe('grid');
    expect(result.positions).toEqual([]);
  });
});
