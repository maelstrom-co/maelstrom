import { requestLayoutComparison } from './layout-comparison.js';
import { button, element } from './panel-elements.js';
import {
  eventLabel,
  fields,
  type InspectorState,
  type PanelEvent,
  type RequestTrace,
} from './panel-model.js';
import type { ViewContext } from './panel-views.js';

export interface LayoutViewSelection {
  requestKey: string;
  instanceId?: string;
  page?: number;
}
const PAGE_SIZE = 200;

export function layoutComparisonView(
  request: RequestTrace,
  events: readonly PanelEvent[],
  context: ViewContext,
): HTMLElement {
  const section = element('section', undefined, 'layout-comparison');
  section.setAttribute('aria-label', 'Request layout comparison');
  section.append(element('h3', 'What changed in the Chart'));
  const comparison = requestLayoutComparison(request, events);
  if (comparison.availability === 'unavailable') {
    section.append(
      element(
        'p',
        `Comparison unavailable. ${comparison.reason}`,
        'muted small',
      ),
    );
    return section;
  }
  section.append(
    element(
      'p',
      'Observed from the start of layout application to response settlement. Application-owned updates may also contribute. These schematic diagrams do not represent browser paint.',
      'muted small',
    ),
  );
  for (const caveat of comparison.caveats)
    section.append(element('p', caveat, 'warning small'));
  const view =
    context.layoutView?.requestKey === request.key
      ? context.layoutView
      : undefined;
  const selectedId = view?.instanceId ?? comparison.changes[0]?.instanceId;
  const select = (instanceId: string, eventKey: string) =>
    context.setLayoutView(
      { requestKey: request.key, instanceId, page: view?.page },
      eventKey,
    );
  const maps = element('div', undefined, 'layout-pair');
  const kinds = new Map(
    comparison.changes.map((change) => [change.instanceId, change.kinds]),
  );
  function miniature(label: string, state: InspectorState, eventKey: string) {
    const figure = element('figure');
    const caption = element('figcaption');
    const evidence = button(label, () => context.selectEvent(eventKey));
    evidence.dataset.focusKey = `layout-boundary:${label}`;
    caption.append(
      evidence,
      element(
        'span',
        `${(state.layout.type ?? fields(state.raw).layoutMode) === 'grid' ? 'Grid cells' : 'Tiling proportions'} · ${state.columns ?? '?'} × ${state.rows ?? '?'} Chart`,
        'muted small',
      ),
    );
    figure.append(caption);
    const map = element('div', undefined, 'minimap comparison-map');
    map.setAttribute('role', 'group');
    map.setAttribute('aria-label', `${label} Chart miniature`);
    if (state.columns && state.rows)
      map.style.aspectRatio = String(
        Math.max(0.5, Math.min(3, state.columns / state.rows)),
      );
    const tiles = state.tiles ?? [];
    const drawn = tiles.slice(0, PAGE_SIZE);
    const selectedTile = tiles.find((tile) => tile.instanceId === selectedId);
    if (selectedTile && !drawn.includes(selectedTile))
      drawn.splice(-1, 1, selectedTile);
    for (const tile of drawn) {
      const item = button(
        tile.instanceId,
        () => select(tile.instanceId, eventKey),
        'tile',
      );
      item.setAttribute(
        'aria-label',
        `${label} Instance ${tile.instanceId}${kinds.has(tile.instanceId) ? `: ${kinds.get(tile.instanceId)?.join(', ')}` : ': unchanged'}`,
      );
      item.setAttribute('aria-pressed', String(tile.instanceId === selectedId));
      item.dataset.focusKey = `layout-tile:${label}:${tile.instanceId}`;
      item.dataset.changed = String(kinds.has(tile.instanceId));
      item.style.left = `${tile.x}%`;
      item.style.top = `${tile.y}%`;
      item.style.width = `${tile.width}%`;
      item.style.height = `${tile.height}%`;
      map.append(item);
    }
    if (state.tiles === null)
      map.append(element('p', 'Geometry unavailable', 'muted small'));
    else if (!tiles.length)
      map.append(element('p', 'No visible Instances', 'muted small'));
    figure.append(map);
    if (tiles.length > PAGE_SIZE)
      figure.append(
        element(
          'p',
          `Showing ${PAGE_SIZE} of ${tiles.length} visible Instances. Select changes in the table to reveal other Instances.`,
          'muted small',
        ),
      );
    maps.append(figure);
  }
  miniature('Before', comparison.before.state, comparison.before.eventKey);
  miniature(
    request.status === 'failed' ? 'After failure' : 'After',
    comparison.after.state,
    comparison.after.eventKey,
  );
  section.append(maps);
  if (comparison.changes.length) {
    const changes = element('table', undefined, 'layout-change-table');
    changes.setAttribute('aria-label', 'Instance layout changes');
    const header = element('thead'),
      titles = element('tr');
    for (const title of ['Instance', 'Observed changes']) {
      const cell = element('th', title);
      cell.scope = 'col';
      titles.append(cell);
    }
    header.append(titles);
    const body = element('tbody');
    const lastPage = Math.max(
      0,
      Math.ceil(comparison.changes.length / PAGE_SIZE) - 1,
    );
    const page = Math.min(lastPage, view?.page ?? 0);
    for (const change of comparison.changes.slice(
      page * PAGE_SIZE,
      (page + 1) * PAGE_SIZE,
    )) {
      const row = element('tr'),
        name = element('th'),
        description = element('td', change.kinds.join(', '));
      name.scope = 'row';
      const choose = button(change.instanceId, () =>
        select(
          change.instanceId,
          change.after ? comparison.after.eventKey : comparison.before.eventKey,
        ),
      );
      choose.setAttribute(
        'aria-label',
        `${change.instanceId}: ${change.kinds.join(', ')}`,
      );
      choose.setAttribute(
        'aria-pressed',
        String(change.instanceId === selectedId),
      );
      choose.dataset.focusKey = `layout-change:${change.instanceId}`;
      name.append(choose);
      row.append(name, description);
      body.append(row);
    }
    changes.append(header, body);
    section.append(changes);
    if (lastPage > 0) {
      const paging = element('div', undefined, 'toolbar');
      for (const [label, index] of [
        ['Previous changes', page - 1],
        ['More changes', page + 1],
      ] as const) {
        const disabled = index < 0 || index > lastPage;
        const control = button(label, () => {
          if (!disabled)
            context.setLayoutView({
              requestKey: request.key,
              instanceId: selectedId,
              page: index,
            });
        });
        control.setAttribute('aria-disabled', String(disabled));
        control.dataset.focusKey = `layout-page:${label}`;
        paging.append(control);
      }
      paging.append(
        element('span', `Page ${page + 1} of ${lastPage + 1}`, 'muted small'),
      );
      section.append(paging);
    }
  } else
    section.append(
      element(
        'p',
        comparison.caveats.length
          ? 'No structural changes detected in the comparable evidence.'
          : 'No structural changes observed.',
        'muted small',
      ),
    );
  if (selectedId) {
    const previous = comparison.before.state.instances.find(
      (item) => item.instanceId === selectedId,
    );
    const next = comparison.after.state.instances.find(
      (item) => item.instanceId === selectedId,
    );
    const detail = element('div', undefined, 'layout-instance-detail');
    detail.append(element('h4', selectedId));
    const describe = (instance: typeof previous) =>
      !instance
        ? 'Not retained'
        : `${instance.variant} · ${instance.visible === undefined ? 'visibility unknown' : instance.visible ? 'visible' : 'hidden'}`;
    detail.append(
      element(
        'p',
        `Before: ${describe(previous)}. After: ${describe(next)}.`,
        'muted small',
      ),
      element('p', 'Supporting snapshots, commands, and outcomes', 'small'),
    );
    const evidence = element('div', undefined, 'layout-evidence');
    const supportingEvents = request.events.filter(
      (event) =>
        [comparison.before.eventKey, comparison.after.eventKey].includes(
          event.key,
        ) ||
        event.metadata.instanceId === selectedId ||
        event.kind.startsWith('client.command.'),
    );
    for (const event of supportingEvents.slice(0, PAGE_SIZE)) {
      const link = button(eventLabel(event), () =>
        context.selectEvent(event.key),
      );
      link.dataset.focusKey = `layout-evidence:${event.key}`;
      link.setAttribute('aria-pressed', String(context.eventKey === event.key));
      evidence.append(link);
    }
    if (supportingEvents.length > PAGE_SIZE)
      evidence.append(
        element(
          'p',
          'More supporting events are available under Request phases.',
          'muted small',
        ),
      );
    detail.append(evidence);
    section.append(detail);
  }
  return section;
}
