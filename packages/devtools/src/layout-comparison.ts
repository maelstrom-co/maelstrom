import {
  fields,
  type InspectorInstance,
  type InspectorState,
  identity,
  inspectState,
  list,
  numeric,
  type PanelEvent,
  type PreviewTile,
  type RequestTrace,
} from './panel-model.js';

type ChangeKind =
  | 'Added'
  | 'Removed'
  | 'Shown'
  | 'Hidden'
  | 'Moved'
  | 'Resized'
  | 'Variant changed';

interface LayoutBoundary {
  eventKey: string;
  state: InspectorState;
}
interface LayoutChange {
  instanceId: string;
  kinds: ChangeKind[];
  before?: InspectorInstance;
  after?: InspectorInstance;
  eventKeys: string[];
}
export type LayoutComparison =
  | { availability: 'unavailable'; reason: string }
  | {
      availability: 'available';
      before: LayoutBoundary;
      after: LayoutBoundary;
      changes: LayoutChange[];
      caveats: string[];
    };

function snapshotState(value: unknown): InspectorState | undefined {
  const snapshot = fields(value);
  if (
    snapshot.version !== 1 ||
    (snapshot.layoutMode !== 'grid' && snapshot.layoutMode !== 'tiling') ||
    !Array.isArray(snapshot.instances) ||
    snapshot.instances.length > 1000 ||
    snapshot.instanceCount !== snapshot.instances.length
  )
    return;
  if (
    snapshot.layout !== null &&
    fields(snapshot.layout).type !== 'grid' &&
    fields(snapshot.layout).type !== 'tiling'
  )
    return;
  const ids = new Set<string>();
  for (const value of snapshot.instances) {
    const instance = fields(value),
      id = identity(instance.instanceId);
    if (
      !id ||
      ids.has(id) ||
      !identity(instance.vesselId) ||
      !identity(instance.variant)
    )
      return;
    ids.add(id);
  }
  const layout = fields(snapshot.layout);
  const state = inspectState({
    retainedInstances: snapshot.instances,
    layoutMode: snapshot.layoutMode,
    chartDimensions: snapshot.chartDimensions,
    layout:
      layout.type === 'grid'
        ? { type: 'grid', positions: layout.positions }
        : layout.type === 'tiling'
          ? { type: 'tiling', tree: layout.tree }
          : null,
  });
  if (snapshot.layout === null) {
    state.tiles = [];
    for (const instance of state.instances) instance.visible = false;
  }
  if (state.tiles?.some((tile) => !ids.has(tile.instanceId)))
    state.tiles = null;
  if (state.tiles === null)
    for (const instance of state.instances) instance.visible = undefined;
  return state;
}

function geometry(state: InspectorState): Map<string, PreviewTile> {
  if (state.tiles === null) return new Map();
  if (state.layout.type !== 'grid')
    return new Map(state.tiles.map((tile) => [tile.instanceId, tile]));
  const cells = new Map<string, PreviewTile>();
  for (const value of list(state.layout.positions)) {
    const item = fields(value),
      position = fields(item.position),
      size = fields(item.size);
    const instanceId = identity(item.instanceId),
      x = numeric(position.column),
      y = numeric(position.row),
      width = numeric(size.width),
      height = numeric(size.height);
    if (
      instanceId &&
      x !== undefined &&
      y !== undefined &&
      width !== undefined &&
      height !== undefined
    )
      cells.set(instanceId, { instanceId, x, y, width, height });
  }
  return cells;
}

export function requestLayoutComparison(
  request: RequestTrace,
  events: readonly PanelEvent[],
): LayoutComparison {
  const starts = request.events.filter(
    (event) =>
      event.kind === 'client.command.started' &&
      event.metadata.command === 'set_layout',
  );
  const ends = request.events.filter(
    (event) =>
      event.kind === 'client.response.applied' ||
      event.kind === 'client.response.failed',
  );
  const start = starts[0],
    end = ends[0];
  if (!start || !end)
    return {
      availability: 'unavailable',
      reason: 'The application baseline or completion event is not retained.',
    };
  if (starts.length !== 1 || ends.length !== 1 || end.index <= start.index)
    return {
      availability: 'unavailable',
      reason:
        'The retained events do not identify one ordered application interval for this request.',
    };
  if (
    fields(start.content).layoutSnapshot === undefined ||
    fields(end.content).layoutSnapshot === undefined
  )
    return {
      availability: 'unavailable',
      reason: `The ${fields(start.content).layoutSnapshot === undefined ? 'baseline' : 'completion'} snapshot was not recorded. Record before reproducing the change. Older recordings may not include layout snapshots.`,
    };
  const beforeState = snapshotState(fields(start.content).layoutSnapshot),
    afterState = snapshotState(fields(end.content).layoutSnapshot);
  if (!beforeState || !afterState)
    return {
      availability: 'unavailable',
      reason:
        'A layout snapshot is redacted, incomplete, unsupported, or exceeds the 1,000 Instance viewer limit. Inspect the retained JSON.',
    };
  const before = { eventKey: start.key, state: beforeState };
  const after = { eventKey: end.key, state: afterState };
  const beforeInstances = new Map(
    before.state.instances.map((item) => [item.instanceId, item]),
  );
  const afterInstances = new Map(
    after.state.instances.map((item) => [item.instanceId, item]),
  );
  const beforeGeometry = geometry(before.state),
    afterGeometry = geometry(after.state);
  const changes: LayoutChange[] = [];
  for (const instanceId of new Set([
    ...beforeInstances.keys(),
    ...afterInstances.keys(),
  ])) {
    const previous = beforeInstances.get(instanceId),
      next = afterInstances.get(instanceId);
    const kinds: ChangeKind[] = [];
    if (!previous) kinds.push('Added');
    else if (!next) kinds.push('Removed');
    else {
      if (previous.visible === false && next.visible === true)
        kinds.push('Shown');
      if (previous.visible === true && next.visible === false)
        kinds.push('Hidden');
      const a = beforeGeometry.get(instanceId),
        b = afterGeometry.get(instanceId);
      if (a && b && before.state.layout.type === after.state.layout.type) {
        // Recursive tiling splits add rounding noise to a 100-unit projection.
        const tolerance = before.state.layout.type === 'tiling' ? 1e-9 : 0;
        if (Math.abs(a.x - b.x) > tolerance || Math.abs(a.y - b.y) > tolerance)
          kinds.push('Moved');
        if (
          Math.abs(a.width - b.width) > tolerance ||
          Math.abs(a.height - b.height) > tolerance
        )
          kinds.push('Resized');
      }
      if (previous.variant !== next.variant) kinds.push('Variant changed');
    }
    if (kinds.length)
      changes.push({
        instanceId,
        kinds,
        before: previous,
        after: next,
        eventKeys: [start.key, end.key],
      });
  }
  const during = events.filter(
    (event) =>
      event.clientId === request.clientId &&
      event.index > start.index &&
      event.index < end.index,
  );
  const caveats: string[] = [];
  if (
    during.some(
      (event) =>
        event.kind === 'client.command.started' &&
        event.requestId !== request.requestId,
    )
  )
    caveats.push(
      'Other commands overlapped this response. The snapshots do not prove which request caused each change.',
    );
  if (
    during.some((event) => event.kind === 'client.chart.resized') ||
    before.state.columns !== after.state.columns ||
    before.state.rows !== after.state.rows
  )
    caveats.push(
      'The Chart resized during application. Each miniature uses its own reported dimensions.',
    );
  if (before.state.tiles === null || after.state.tiles === null)
    caveats.push(
      'Some geometry is unavailable. Visibility, movement, and size changes cannot be fully compared.',
    );
  if (
    before.state.layout.type &&
    after.state.layout.type &&
    before.state.layout.type !== after.state.layout.type
  )
    caveats.push(
      'The layout mode changed. Movement and size use different units and are not compared.',
    );
  return { availability: 'available', before, after, changes, caveats };
}
