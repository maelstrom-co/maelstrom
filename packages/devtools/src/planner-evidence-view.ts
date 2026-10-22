import { button, element } from './panel-elements.js';
import { duration, humanize, type RequestTrace } from './panel-model.js';
import type { ViewContext } from './panel-views.js';
import {
  type PlannerFact,
  type PlannerObservation,
  plannerEvidence,
} from './planner-evidence.js';

const unavailable = {
  'not-reported': 'Not reported',
  redacted: 'Redacted',
  truncated: 'Truncated',
  unreadable: 'Invalid or unavailable',
} as const;

function value<T>(fact: PlannerFact<T>, format: (value: T) => string): string {
  return fact.kind === 'reported'
    ? format(fact.value)
    : unavailable[fact.reason];
}

function label(observation: PlannerObservation): string {
  if (observation.kind === 'planning')
    return observation.phase === 'started'
      ? 'Planning started'
      : `Planning outcome · ${value(observation.outcome, humanize)}`;
  if (observation.kind === 'attempt')
    return observation.attempt.kind === 'reported'
      ? `Attempt ${observation.attempt.value} reported`
      : `Attempt number: ${value(observation.attempt, String)}`;
  if (observation.kind === 'validation')
    return observation.outcome.kind !== 'reported'
      ? `Validation outcome: ${value(observation.outcome, humanize)}`
      : observation.outcome.value === 'succeeded'
        ? 'Validation passed'
        : 'Validation failed';
  return observation.source === 'llm' ? 'LLM call report' : 'Jev call report';
}

export function plannerEvidenceView(
  request: RequestTrace,
  selectedEventKey: string | undefined,
  context: ViewContext,
): HTMLDetailsElement {
  const observations = plannerEvidence(request);
  const details = element('details', undefined, 'planner-evidence');
  details.hidden = Boolean(context.comparison && observations.length === 0);
  details.setAttribute('aria-label', 'Planner evidence');
  details.dataset.disclosurePurpose = 'planner';
  details.dataset.disclosureKey = JSON.stringify(['planner', request.key]);
  const summary = element(
    'summary',
    `Planner evidence · ${observations.length} retained ${observations.length === 1 ? 'observation' : 'observations'}`,
  );
  summary.dataset.focusKey = `planner-summary:${request.key}`;
  details.append(summary);
  if (!observations.length) {
    details.append(
      element(
        'p',
        'No planner observations are retained for this request. Check host diagnostic forwarding or inspect a recording made before reproducing the request.',
        'muted small',
      ),
    );
    return details;
  }
  details.append(
    element(
      'p',
      'These observations do not establish attempt ownership or candidate acceptance. Validation results do not establish the final client outcome.',
      'muted small',
    ),
    element(
      'p',
      'Usage belongs to each source report and can include internal provider calls. Durations overlap; do not add them.',
      'muted small',
    ),
  );
  const rows = element('div', undefined, 'planner-observations');
  const pageIndex = Math.min(
    context.plannerPage?.requestKey === request.key
      ? context.plannerPage.index
      : 0,
    Math.ceil(observations.length / 50) - 1,
  );
  const start = pageIndex * 50;
  const end = Math.min(start + 50, observations.length);
  rows.setAttribute('role', 'region');
  rows.setAttribute('aria-label', 'Planner observations');
  rows.tabIndex = 0;
  rows.dataset.focusKey = 'planner-observations';
  rows.dataset.scrollKey = JSON.stringify([
    'planner',
    request.key,
    context.phaseCounterparts?.other ?? 'single',
    pageIndex,
  ]);
  for (const observation of observations.slice(start, end)) {
    const row = button(label(observation), () =>
      context.selectEvent(observation.eventKey),
    );
    if (observation.kind === 'call') {
      row.replaceChildren(element('span', label(observation), 'row-title'));
      const metrics = element('span', undefined, 'planner-metrics');
      for (const [title, reported] of [
        ['Source', `engine.${observation.source}.call`],
        ['Model', value(observation.model, String)],
        ['Stage', value(observation.stage, String)],
        ['Reported outcome', value(observation.outcome, humanize)],
        ['Reported duration', value(observation.durationMs, duration)],
        ['Input tokens', value(observation.inputTokens, String)],
        ['Output tokens', value(observation.outputTokens, String)],
      ])
        metrics.append(element('span', `${title}: ${reported}`));
      row.append(metrics);
    }
    if (observation.kind === 'planning')
      row.append(
        element(
          'span',
          `Reported duration: ${value(observation.durationMs, duration)}`,
          'row-detail',
        ),
      );
    row.dataset.focusKey = `planner:${observation.eventKey}`;
    row.dataset.focusFallback = 'details';
    row.setAttribute(
      'aria-pressed',
      String(selectedEventKey === observation.eventKey),
    );
    rows.append(row);
  }
  details.append(rows);
  if (observations.length > 50) {
    details.append(
      element(
        'p',
        `Showing ${start + 1}–${end} of ${observations.length} retained planner observations. This view limit does not remove recorded events.`,
        'muted small',
      ),
    );
    const previous = button('Previous planner observations', () => {
      if (pageIndex > 0)
        context.selectPlannerPage({
          requestKey: request.key,
          index: pageIndex - 1,
        });
    });
    previous.setAttribute('aria-disabled', String(pageIndex === 0));
    previous.dataset.focusKey = 'previous-planner-observations';
    const next = button('Next planner observations', () => {
      if (end < observations.length)
        context.selectPlannerPage({
          requestKey: request.key,
          index: pageIndex + 1,
        });
    });
    next.setAttribute('aria-disabled', String(end === observations.length));
    next.dataset.focusKey = 'next-planner-observations';
    previous.dataset.focusFallback = next.dataset.focusFallback = 'details';
    const controls = element('div', undefined, 'phase-heading');
    controls.append(previous, next);
    details.append(controls);
  }
  return details;
}
