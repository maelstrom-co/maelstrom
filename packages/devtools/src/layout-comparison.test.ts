import { expect, test } from 'bun:test';
import { requestLayoutComparison } from './layout-comparison.js';
import { groupRequests, panelEvents } from './panel-model.js';

function snapshot(
  instances: readonly { instanceId: string; variant?: string }[],
  positions: readonly [string, number, number, number, number][],
) {
  return {
    version: 1,
    instanceCount: instances.length,
    layoutMode: 'grid',
    chartDimensions: { columns: 8, rows: 4 },
    instances: instances.map(({ instanceId, variant = 'main' }) => ({
      instanceId,
      vesselId: 'calendar',
      variant,
    })),
    layout: {
      type: 'grid',
      positions: positions.map(([instanceId, column, row, width, height]) => ({
        instanceId,
        position: { column, row },
        size: { width, height },
      })),
    },
  };
}
function boundary(
  kind: string,
  layoutSnapshot: unknown,
  requestId = 'request',
  clientId = 'app',
) {
  return {
    kind,
    id: crypto.randomUUID(),
    requestId,
    metadata: { clientId, command: 'set_layout' },
    content: { layoutSnapshot },
  };
}

test('layout comparisons distinguish removal from hiding and use reported grid cells for geometry changes', () => {
  const before = snapshot(
    [
      { instanceId: 'removed' },
      { instanceId: 'hidden' },
      { instanceId: 'shown' },
      { instanceId: 'changed' },
    ],
    [
      ['removed', 0, 0, 1, 1],
      ['hidden', 1, 0, 1, 1],
      ['changed', 2, 0, 1, 1],
    ],
  );
  const after = snapshot(
    [
      { instanceId: 'added' },
      { instanceId: 'hidden' },
      { instanceId: 'shown' },
      { instanceId: 'changed', variant: 'week' },
    ],
    [
      ['added', 0, 0, 1, 1],
      ['shown', 1, 0, 1, 1],
      ['changed', 3, 1, 2, 2],
    ],
  );
  const events = panelEvents([
    boundary('client.command.started', before),
    boundary('client.response.applied', after),
  ]);
  const comparison = requestLayoutComparison(groupRequests(events)[0], events);
  expect(comparison.availability).toBe('available');
  if (comparison.availability !== 'available')
    throw new Error(comparison.reason);
  expect(
    comparison.changes.map(({ instanceId, kinds }) => [instanceId, kinds]),
  ).toEqual([
    ['removed', ['Removed']],
    ['hidden', ['Hidden']],
    ['shown', ['Shown']],
    ['changed', ['Moved', 'Resized', 'Variant changed']],
    ['added', ['Added']],
  ]);
  expect(comparison.changes[3].eventKeys).toEqual(events.map(({ key }) => key));
});

test('older recordings and lost baselines never appear to be an empty Chart', () => {
  const events = panelEvents([
    boundary('client.command.started', undefined),
    boundary(
      'client.response.applied',
      snapshot([{ instanceId: 'one' }], [['one', 0, 0, 1, 1]]),
    ),
  ]);
  expect(requestLayoutComparison(groupRequests(events)[0], events)).toEqual({
    availability: 'unavailable',
    reason:
      'The baseline snapshot was not recorded. Record before reproducing the change. Older recordings may not include layout snapshots.',
  });
});

test.each([
  { ...snapshot([{ instanceId: 'one' }], []), instances: [] },
  snapshot([{ instanceId: '[REDACTED]' }], []),
  { ...snapshot([], []), version: 99 },
  { ...snapshot([], []), layoutMode: undefined },
  { ...snapshot([], []), layout: { type: { toString: null } } },
])('incomplete or redacted snapshots cannot invent removals', (damaged) => {
  const events = panelEvents([
    boundary('client.command.started', snapshot([{ instanceId: 'one' }], [])),
    boundary('client.response.applied', damaged),
  ]);
  const comparison = requestLayoutComparison(groupRequests(events)[0], events);
  expect(comparison.availability).toBe('unavailable');
});

test('damaged geometry remains unknown while structural Variant evidence stays usable', () => {
  const before = {
    ...snapshot([{ instanceId: 'one' }], []),
    layout: { type: 'grid' },
  };
  const after = snapshot(
    [{ instanceId: 'one', variant: 'week' }],
    [['one', 1, 0, 1, 1]],
  );
  const events = panelEvents([
    boundary('client.command.started', before),
    boundary('client.response.applied', after),
  ]);
  const comparison = requestLayoutComparison(groupRequests(events)[0], events);
  if (comparison.availability !== 'available')
    throw new Error(comparison.reason);
  expect(comparison.changes.map(({ kinds }) => kinds)).toEqual([
    ['Variant changed'],
  ]);
  expect(comparison.before.state.instances[0].visible).toBeUndefined();
  expect(comparison.caveats).toContain(
    'Some geometry is unavailable. Visibility, movement, and size changes cannot be fully compared.',
  );
});

test('overlapping app work and Chart resizes limit attribution without borrowing another request snapshot', () => {
  const before = snapshot([{ instanceId: 'one' }], [['one', 0, 0, 1, 1]]);
  const after = { ...before, chartDimensions: { columns: 4, rows: 4 } };
  const events = panelEvents([
    boundary('client.command.started', before),
    boundary('client.command.started', snapshot([], []), 'other', 'other-app'),
    boundary('client.command.started', snapshot([], []), 'overlap'),
    { kind: 'client.chart.resized', metadata: { clientId: 'app' } },
    boundary('client.response.applied', snapshot([], []), 'overlap'),
    boundary('client.response.applied', after),
  ]);
  const request = groupRequests(events).find(
    (request) => request.requestId === 'request',
  )!;
  const comparison = requestLayoutComparison(request, events);
  if (comparison.availability !== 'available')
    throw new Error(comparison.reason);
  expect(comparison.changes).toEqual([]);
  expect(comparison.caveats).toContain(
    'Other commands overlapped this response. The snapshots do not prove which request caused each change.',
  );
  expect(comparison.caveats).toContain(
    'The Chart resized during application. Each miniature uses its own reported dimensions.',
  );
  expect(comparison.after.state.columns).toBe(4);
});

test('reused request IDs cannot combine snapshots from separate applications of a response', () => {
  const empty = snapshot([], []);
  const events = panelEvents([
    boundary('client.command.started', empty),
    boundary('client.response.applied', empty),
    boundary('client.command.started', empty),
    boundary('client.response.applied', empty),
  ]);
  expect(
    requestLayoutComparison(groupRequests(events)[0], events).availability,
  ).toBe('unavailable');
});

test('tiling comparisons preserve weighted proportions and never compare them as grid cells', () => {
  const before = {
    ...snapshot([{ instanceId: 'a' }, { instanceId: 'b' }], []),
    layoutMode: 'tiling',
    layout: { type: 'tiling', tree: ['V:1,3', 'ID:a', 'ID:b'] },
  };
  const after = {
    ...before,
    layout: { type: 'tiling', tree: ['V:1,1', 'ID:a', 'ID:b'] },
  };
  const events = panelEvents([
    boundary('client.command.started', before),
    boundary('client.response.applied', after),
  ]);
  const comparison = requestLayoutComparison(groupRequests(events)[0], events);
  if (comparison.availability !== 'available')
    throw new Error(comparison.reason);
  expect(
    comparison.before.state.tiles?.map(({ instanceId, x, width }) => [
      instanceId,
      x,
      width,
    ]),
  ).toEqual([
    ['a', 0, 25],
    ['b', 25, 75],
  ]);
  expect(
    comparison.changes.map(({ instanceId, kinds }) => [instanceId, kinds]),
  ).toEqual([
    ['a', ['Resized']],
    ['b', ['Moved', 'Resized']],
  ]);
});

test.each([
  'V',
  'H',
])('equivalent flat and nested %s tiling splits do not imply movement or resizing', (direction) => {
  const before = {
    ...snapshot(
      [{ instanceId: 'a' }, { instanceId: 'b' }, { instanceId: 'c' }],
      [],
    ),
    layoutMode: 'tiling',
    layout: {
      type: 'tiling',
      tree: [`${direction}:1,1,1`, 'ID:a', 'ID:b', 'ID:c'],
    },
  };
  const after = {
    ...before,
    layout: {
      type: 'tiling',
      tree: [`${direction}:1,2`, 'ID:a', direction, 'ID:b', 'ID:c'],
    },
  };
  const events = panelEvents([
    boundary('client.command.started', before),
    boundary('client.response.applied', after),
  ]);
  const comparison = requestLayoutComparison(groupRequests(events)[0], events);
  if (comparison.availability !== 'available')
    throw new Error(comparison.reason);
  expect(comparison.changes).toEqual([]);
});

test('imported layout declarations cannot add phantom Instances or override the authoritative snapshot', () => {
  const before = {
    ...snapshot([{ instanceId: 'real' }], []),
    layoutMode: 'tiling',
    layout: { type: 'tiling', tree: ['ID:real'] },
  };
  const ghosts = Array.from({ length: 1100 }, (_, i) => ({
    instanceId: `ghost-${i}`,
    vesselId: 'vessel',
    variant: 'main',
  }));
  const after = {
    ...snapshot([], []),
    layoutMode: 'tiling',
    retainedInstances: ghosts,
    snapshot: { retainedInstances: ghosts },
    layout: { type: 'tiling', tree: [], instances: ghosts },
  };
  const events = panelEvents([
    boundary('client.command.started', before),
    boundary('client.response.applied', after),
  ]);
  const comparison = requestLayoutComparison(groupRequests(events)[0], events);
  if (comparison.availability !== 'available')
    throw new Error(comparison.reason);
  expect(comparison.after.state.instances).toEqual([]);
  expect(
    comparison.changes.map(({ instanceId, kinds }) => [instanceId, kinds]),
  ).toEqual([['real', ['Removed']]]);
});
