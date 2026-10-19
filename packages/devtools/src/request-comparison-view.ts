import { button, element } from './panel-elements.js';
import {
  duration,
  type RequestTrace,
  requestCounterparts,
  requestEventCoverage,
  requestPhases,
  requestTimingComparison,
} from './panel-model.js';
import type {
  ComparisonRequest,
  RenderedView,
  RequestComparisonSelection,
  ViewContext,
} from './panel-views.js';

function empty(message: string): HTMLElement {
  return element('p', message, 'empty');
}

function comparisonTable(label: string, titles: readonly string[]) {
  const table = element('table', undefined, 'comparison-timings');
  table.setAttribute('aria-label', label);
  const head = element('thead'),
    row = element('tr'),
    body = element('tbody');
  for (const title of titles) {
    const cell = element('th', title);
    cell.scope = 'col';
    row.append(cell);
  }
  head.append(row);
  table.append(head, body);
  return { table, body };
}

export function requestComparisonView(
  context: ViewContext,
  selection: RequestComparisonSelection,
  retained: RequestTrace[],
  visible: RequestTrace[],
  navigation: HTMLElement,
  renderDetails: (request: RequestTrace, context: ViewContext) => RenderedView,
): RenderedView {
  const content = element('section', undefined, 'request-comparison');
  content.setAttribute('aria-label', 'Request comparison');
  const header = element('header', undefined, 'comparison-header');
  const stop = button('Exit comparison', () => context.setComparison());
  stop.dataset.focusKey = 'exit-comparison';
  const guidance = element('details', undefined, 'comparison-help');
  guidance.dataset.disclosureKey = JSON.stringify([
    'comparison-help',
    selection.a.key,
    selection.b?.key,
  ]);
  const guidanceSummary = element('summary', 'Comparison help');
  guidanceSummary.dataset.focusKey = 'comparison-help';
  guidance.append(
    guidanceSummary,
    element(
      'p',
      `Select a request in the list for ${selection.choosing.toUpperCase()}. Both identities stay selected through new activity. Retention limits still apply.`,
      'muted small',
    ),
    element(
      'p',
      'Durations use each producer’s clock. Both requests share one duration scale. Observed order is not a shared clock, and nested work overlaps. Unmatched means absent from the other request’s retained evidence. Incomplete evidence stays unknown. Similar metadata does not pair attempts or prove that work did not occur.',
      'muted small',
    ),
  );
  header.append(element('h3', 'Compare requests'), stop, guidance);
  const overview = element('div', undefined, 'comparison-overview');
  overview.append(header);
  const requests = {
    a: retained.find((request) => request.key === selection.a.key),
    b: retained.find((request) => request.key === selection.b?.key),
  };
  const phaseMaximumMs = [requests.a, requests.b].reduce(
    (maximum, request) =>
      request
        ? requestPhases(request).reduce(
            (max, phase) => Math.max(max, phase.durationMs ?? 0),
            maximum,
          )
        : maximum,
    0,
  );
  const { table: timings, body } = comparisonTable('Compared request timings', [
    'Reported duration',
    'A',
    'B',
    'B − A',
  ]);
  for (const { label, aMs, bMs, deltaMs } of requestTimingComparison(
    requests.a,
    requests.b,
  )) {
    const row = element('tr'),
      title = element('th', label);
    title.scope = 'row';
    const timing = (
      request: RequestTrace | undefined,
      ms: number | undefined,
    ) =>
      label === 'Request round-trip' && request?.push
        ? 'Not applicable (push)'
        : duration(ms);
    row.append(
      title,
      element('td', timing(requests.a, aMs)),
      element('td', timing(requests.b, bMs)),
      element(
        'td',
        deltaMs === undefined
          ? 'Not comparable'
          : `${deltaMs < 0 ? '−' : deltaMs > 0 ? '+' : ''}${duration(Math.abs(deltaMs))}`,
      ),
    );
    body.append(row);
  }
  overview.append(timings);
  content.append(overview);
  const columns = element('div', undefined, 'comparison-columns');
  const coverage = element('details');
  coverage.dataset.disclosureKey = JSON.stringify([
    'comparison-coverage',
    selection.a.key,
    selection.b?.key,
  ]);
  const coverageSummary = element('summary', 'Compare observed event counts');
  coverageSummary.dataset.focusKey = 'comparison-coverage';
  coverage.append(
    coverageSummary,
    element(
      'p',
      'Counts include repeated events. Not observed means absent from retained evidence, not proof that work did not occur.',
      'muted small',
    ),
  );
  const { table: coverageTable, body: coverageBody } = comparisonTable(
    'Compared event coverage',
    ['Event kind', 'A', 'B'],
  );
  const eventCoverage = requestEventCoverage(requests.a, requests.b);
  for (const count of eventCoverage.slice(0, 50)) {
    const row = element('tr'),
      title = element('th', count.kind);
    title.scope = 'row';
    row.append(
      title,
      element(
        'td',
        !requests.a
          ? 'Unavailable'
          : count.a
            ? String(count.a)
            : 'Not observed',
      ),
      element(
        'td',
        !requests.b
          ? 'Unavailable'
          : count.b
            ? String(count.b)
            : 'Not observed',
      ),
    );
    coverageBody.append(row);
  }
  coverage.append(coverageTable);
  if (eventCoverage.length > 50)
    coverage.append(
      element(
        'p',
        `${eventCoverage.length - 50} more event kinds. Inspect each request’s phases for all retained events.`,
        'muted small',
      ),
    );
  content.append(coverage);
  const comparisonEvents: NonNullable<RenderedView['comparisonEvents']> = {};
  const signature: unknown[] = [
    'comparison',
    selection,
    context.query,
    context.issueCategory,
    context.clientId,
  ];
  const sourceEvents = [
    ...context.evidence.events,
    ...(context.evidence.requestEvents ?? []),
  ];
  const sourceIncomplete = Boolean(
    context.evidence.unreadableEvents ||
      context.evidence.droppedRequestEvents ||
      context.evidence.dropped ||
      context.evidence.omittedRequestEvents ||
      context.evidence.omitted ||
      sourceEvents.some(
        (event) =>
          (!event.requestId || !event.clientId) &&
          (event.raw.requestId !== undefined ||
            /^(?:client\.(?:request|response|command|action)|engine)\./.test(
              event.kind,
            )),
      ),
  );
  signature.push(sourceIncomplete);
  for (const side of ['a', 'b'] as const) {
    const slot = selection[side],
      request = requests[side];
    const column = element('section', undefined, 'comparison-column');
    column.setAttribute('aria-label', `Comparison ${side.toUpperCase()}`);
    column.tabIndex = 0;
    column.dataset.focusKey = `comparison-column-${side}`;
    const choose = button(`Choose ${side.toUpperCase()}`, () =>
      context.setComparison({ ...selection, choosing: side }),
    );
    choose.dataset.focusKey = `choose-comparison-${side}`;
    choose.setAttribute('aria-pressed', String(selection.choosing === side));
    choose.title = `Select a request in the list to replace ${side.toUpperCase()}.`;
    const sideHeader = element('header', undefined, 'comparison-side-header');
    sideHeader.append(element('h3', side.toUpperCase()));
    if (slot) {
      const [clientId, requestId] = JSON.parse(slot.key) as [string, string];
      const identity = element(
        'p',
        `${context.appLabel(clientId)} · ${clientId} · Request ${requestId}`,
        'mono small comparison-identity',
      );
      identity.setAttribute('role', 'region');
      identity.setAttribute(
        'aria-label',
        `${side.toUpperCase()} request identity`,
      );
      identity.tabIndex = 0;
      identity.dataset.focusKey = `comparison-${side}:identity`;
      identity.dataset.scrollKey = JSON.stringify([side, slot.key, 'identity']);
      identity.title = identity.textContent ?? '';
      sideHeader.append(identity);
    }
    sideHeader.append(choose);
    column.append(sideHeader);
    if (!slot) column.append(empty('Select a second request from the list.'));
    else if (!request)
      column.append(
        empty(
          'Selected request evidence is no longer retained. Choose another request.',
        ),
      );
    else {
      const updateSlot = (
        patch: Partial<ComparisonRequest>,
        inspectEvent = false,
      ) =>
        context.setComparison({
          ...selection,
          [side]: { ...slot, ...patch },
          lastSelectedSide: inspectEvent ? side : selection.lastSelectedSide,
        });
      const detail = renderDetails(request, {
        ...context,
        requestKey: request.key,
        eventKey: slot.eventKey ?? '',
        phasePage: slot.phasePage,
        stageTimingLimit: slot.stageTimingLimit,
        setStageTimingLimit: (stageTimingLimit) =>
          updateSlot({ stageTimingLimit }),
        phaseMaximumMs,
        phaseCounterparts: {
          other: side === 'a' ? 'b' : 'a',
          events: requestCounterparts(
            request,
            requests[side === 'a' ? 'b' : 'a'],
            sourceIncomplete,
          ),
        },
        phaseBars: slot.phaseBars ?? context.phaseBars,
        setPhaseBars: (phaseBars) => updateSlot({ phaseBars }),
        layoutView: slot.layoutView,
        issueCategory: 'all',
        selectEvent: (eventKey) =>
          updateSlot({ eventKey, phasePage: undefined }, true),
        selectPhasePage: (phasePage) => updateSlot({ phasePage }),
        setLayoutView: (layoutView, eventKey) =>
          updateSlot(
            {
              layoutView,
              ...(eventKey ? { eventKey, phasePage: undefined } : {}),
            },
            Boolean(eventKey),
          ),
      });
      if (!visible.some((item) => item.key === request.key))
        detail.content.prepend(
          element(
            'p',
            'This request is hidden from the list by the current filters. Its retained evidence remains available here.',
            'muted small',
          ),
        );
      for (const node of detail.content.querySelectorAll<HTMLElement>(
        '[data-focus-key]',
      ))
        node.dataset.focusKey = `comparison-${side}:${node.dataset.focusKey}`;
      for (const [index, node] of Array.from(
        detail.content.querySelectorAll('details'),
      ).entries()) {
        node.dataset.disclosureKey = JSON.stringify([
          side,
          slot.key,
          node.dataset.disclosurePurpose ?? index,
        ]);
        const summary = node.querySelector('summary');
        if (summary)
          summary.dataset.focusKey = `disclosure:${node.dataset.disclosureKey}`;
      }
      detail.content.classList.add('comparison-details');
      detail.content.setAttribute('role', 'region');
      detail.content.setAttribute(
        'aria-label',
        `${side.toUpperCase()} request details`,
      );
      detail.content.tabIndex = 0;
      detail.content.dataset.focusKey = `comparison-${side}:details`;
      detail.content.dataset.scrollKey = JSON.stringify([side, slot.key]);
      comparisonEvents[side] = detail.raw;
      const placeholder = element('div', undefined, 'comparison-evidence');
      placeholder.dataset.comparisonEvidence = side;
      column.append(detail.content, placeholder);
      signature.push(...(detail.contentIdentity ?? []));
    }
    columns.append(column);
  }
  content.append(columns);
  return {
    navigation,
    content,
    raw: undefined,
    rawTitle: 'Selected comparison events',
    contentIdentity: signature,
    comparisonEvents,
  };
}
