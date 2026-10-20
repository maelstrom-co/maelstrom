import { projectDiagnosticMetadata } from '@maelstrom-co/telemetry/integration';
import {
  duration,
  fields,
  humanize,
  type PanelEvent,
  text,
  voiceTimeline,
} from './panel-model.js';
import {
  button,
  element,
  empty,
  type RenderedView,
  type ViewContext,
} from './panel-views.js';
import {
  type VoiceTimelineControls,
  type VoiceViewState,
  voiceGenerationLabel,
  voiceLifetimeLabel,
} from './voice-timeline-controls.js';

function label(event: PanelEvent): string {
  const labels: Record<string, string> = {
    'voice.tool.called': 'Tool called',
    'voice.tool.result': 'Tool result',
    'voice.tool.cancelled': 'Tool cancelled',
    'voice.transcript.fragment': 'Transcript fragment',
    'voice.transcript.entry': 'Transcript entry',
    'voice.media': 'Media changed',
    'voice.observations': 'Session observations',
    'voice.provider.wire': 'Provider observation',
    'voice.transport': 'Transport observation',
  };
  return labels[event.kind] ?? humanize(event.kind.replace(/^voice\./, ''));
}

const tracks = [
  'Media',
  'Transcript',
  'Tools',
  'Provider',
  'Connection',
] as const;
function track(event: PanelEvent): number {
  if (event.kind === 'voice.media') return 0;
  if (event.kind.startsWith('voice.transcript.')) return 1;
  if (event.kind.startsWith('voice.tool.')) return 2;
  if (event.kind.startsWith('voice.provider.')) return 3;
  return 4;
}

function facts(event: PanelEvent): string {
  const metadata = event.metadata;
  const speech = text(metadata.userSpeech);
  const audio = text(metadata.incomingAudio);
  const outcome =
    projectDiagnosticMetadata(event.kind, metadata)?.outcome ??
    text(metadata.responseOutcome) ??
    text(metadata.outcome) ??
    text(metadata.status);
  return [
    text(metadata.tool),
    text(metadata.role),
    speech ? `Speech ${speech}` : undefined,
    audio ? `Incoming audio ${audio}` : undefined,
    text(metadata.eventType) ?? text(metadata.type),
    outcome ? humanize(outcome) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function voiceTimelineView(
  context: ViewContext,
  state: VoiceViewState,
  change: (next: VoiceViewState, resetPage?: boolean) => void,
  openRequest: (key: string) => void,
  controls: VoiceTimelineControls,
  knownAmbiguities?: (laneKey: string) => boolean,
): RenderedView {
  const all = voiceTimeline(context.evidence, knownAmbiguities)
    .filter(
      (lane) =>
        context.clientId === 'all' || lane.clientId === context.clientId,
    )
    .sort(
      (left, right) =>
        (left.events.at(-1)?.index ?? -1) - (right.events.at(-1)?.index ?? -1),
    );
  const navigation = element('div');
  const content = element('section', undefined, 'voice-timeline');
  const pagingButton = (label: string, key: string) => {
    const node = button(label, context.more);
    node.dataset.focusKey = key;
    node.dataset.focusFallback = 'Voice provider lifetime';
    return node;
  };
  controls.update(context, state, all, change);
  const lanes = all.filter(
    (lane) =>
      (state.provider === 'all' || lane.providerKey === state.provider) &&
      (state.generation === 'all' || lane.generationKey === state.generation),
  );
  const selected = state.lane
    ? lanes.find((lane) => lane.key === state.lane)
    : (lanes.find((lane) =>
        lane.events.some((event) => event.key === state.eventKey),
      ) ?? lanes.at(-1));
  const visibleLanes = [...lanes].reverse().slice(0, context.pageSize);
  if (selected && !visibleLanes.includes(selected)) visibleLanes.push(selected);
  for (const lane of visibleLanes) {
    const row = button(
      '',
      () => change({ ...state, lane: lane.key, eventKey: undefined }, true),
      'row-button',
    );
    row.setAttribute('aria-pressed', String(lane === selected));
    row.dataset.focusKey = `voice:${lane.key}`;
    row.dataset.focusFallback = 'Voice provider lifetime';
    row.append(
      element('strong', lane.provider ?? 'Voice'),
      element('span', voiceGenerationLabel(lane)),
      element('span', voiceLifetimeLabel(lane), 'muted small'),
      ...(lane.contextAmbiguous
        ? [element('span', 'Conflicting app/provider context', 'muted small')]
        : []),
      element(
        'span',
        `${lane.clientId ? context.appLabel(lane.clientId) : 'App not reported'} · ${lane.events.length} observations`,
        'muted small',
      ),
    );
    navigation.append(row);
  }
  if (lanes.length > visibleLanes.length) {
    const more = pagingButton(
      `Show more voice lanes (${visibleLanes.length} of ${lanes.length})`,
      'voice-more-lanes',
    );
    navigation.append(more);
  }
  if (!selected) {
    content.append(
      empty(
        state.lane
          ? 'The selected voice lane is no longer retained.'
          : 'No voice observations match this selection. Try another Evidence source or reset the filters.',
      ),
    );
    return {
      controls: controls.element,
      navigation,
      content,
      raw: { message: 'No selected voice evidence.' },
      rawTitle: 'Voice evidence',
    };
  }
  content.append(
    element(
      'h3',
      `${selected.provider ?? 'Voice'} · ${voiceGenerationLabel(selected)}`,
    ),
  );
  if (selected.groupingDisabled)
    content.append(
      element(
        'p',
        'Grouping is unavailable because identity history cannot establish ownership. Individual observations and direct request links remain inspectable.',
        'muted small',
      ),
    );
  const unlinked = selected.groups.filter(
    (group) => group.type === 'unlinked',
  ).length;
  content.append(
    element(
      'p',
      `${selected.events.length} retained observations · ${unlinked} not linked to a turn. Order follows this evidence buffer, not a shared clock.`,
      'muted small',
    ),
  );
  const limits = element('details', undefined, 'voice-limits');
  limits.dataset.disclosureKey = 'voice-evidence-limits';
  limits.append(
    element('summary', 'What can this timeline prove?'),
    element(
      'p',
      'Tool invocations and provider responses group only by explicit identity. Session and provider generations are independent. Speech, transcript, and playback do not establish a complete conversational turn. Incoming audio does not prove audibility. Voice source loss is not reported by this feed; collector eviction is separate.',
      'muted small',
    ),
  );
  content.append(limits);
  const event = state.eventKey
    ? selected.events.find((event) => event.key === state.eventKey)
    : selected.events.at(-1);
  const events = selected.events.slice(-context.pageSize);
  const diagram = element('div', undefined, 'voice-diagram');
  diagram.setAttribute('role', 'group');
  diagram.setAttribute('aria-label', 'Voice evidence timeline');
  diagram.tabIndex = 0;
  diagram.dataset.scrollKey = `voice-diagram:${selected.key}`;
  const board = element('div', undefined, 'voice-board');
  board.style.gridTemplateColumns = `90px repeat(${events.length}, minmax(32px, 1fr))`;
  board.style.minWidth = `${90 + events.length * 32}px`;
  tracks.forEach((name, index) => {
    const title = element('span', name, 'voice-track-label');
    title.style.gridRow = String(index + 1);
    title.style.gridColumn = '1';
    board.append(title);
  });
  const groupFor = new Map(
    selected.groups.flatMap((group) =>
      group.events.map((event) => [event.key, group] as const),
    ),
  );
  const table = element('table', undefined, 'voice-events');
  const head = element('thead');
  const headings = element('tr');
  for (const heading of ['Order', 'Observation', 'Correlation', 'Duration'])
    headings.append(element('th', heading));
  head.append(headings);
  const body = element('tbody');
  events.forEach((item, index) => {
    const order = selected.events.length - events.length + index + 1;
    const name = `Inspect observation ${order}: ${label(item)}`;
    const select = (diagram: boolean) => {
      const node = button(
        diagram ? String(order) : label(item),
        () => change({ ...state, lane: selected.key, eventKey: item.key }),
        diagram ? 'voice-point' : 'voice-event',
      );
      node.setAttribute('aria-label', name);
      node.setAttribute('aria-pressed', String(item.key === event?.key));
      node.dataset.focusKey = `${diagram ? 'voice-point' : 'voice-event'}:${item.key}`;
      node.dataset.focusFallback = 'Voice provider lifetime';
      return node;
    };
    const point = select(true);
    point.title = `${name}${facts(item) ? ` · ${facts(item)}` : ''}`;
    point.style.gridColumn = String(index + 2);
    point.style.gridRow = String(track(item) + 1);
    point.dataset.track = String(track(item));
    board.append(point);
    const row = element('tr');
    const observation = element('td');
    observation.append(
      select(false),
      element('span', facts(item), 'muted small'),
    );
    row.append(
      element('td', String(order)),
      observation,
      element('td', groupFor.get(item.key)?.label ?? 'Not linked to a turn'),
      element('td', duration(item.metadata.durationMs)),
    );
    body.append(row);
  });
  diagram.append(board);
  table.append(head, body);
  content.append(diagram, table);
  if (selected.events.length > events.length)
    content.append(
      pagingButton(
        `Show more voice observations (${events.length} of ${selected.events.length})`,
        'voice-more-observations',
      ),
    );
  if (state.eventKey && !event)
    content.append(
      element(
        'p',
        'The selected observation is no longer retained in this lane.',
        'warning',
      ),
    );
  const group = event ? groupFor.get(event.key) : undefined;
  if (group?.requests.length) {
    const requests = element('section', undefined, 'voice-requests');
    requests.append(element('h3', 'Related request evidence'));
    for (const request of group.requests.slice(0, context.pageSize)) {
      const node = button(`Open request ${request.requestId}`, () =>
        openRequest(request.key),
      );
      node.disabled = !request.available;
      if (!request.available)
        node.title = request.ambiguous
          ? 'Retained app context contradicts this request link.'
          : 'Request identity was reported; supporting request events are not retained.';
      requests.append(node);
      if (!request.available)
        requests.append(
          element(
            'p',
            request.ambiguous
              ? 'Related request ownership is ambiguous.'
              : 'Related request events are not retained.',
            'muted small',
          ),
        );
    }
    if (group.requests.length > context.pageSize)
      requests.append(
        pagingButton(
          `Show more request links (${context.pageSize} of ${group.requests.length})`,
          'voice-more-requests',
        ),
      );
    content.append(requests);
  } else if (event?.kind.startsWith('voice.tool.'))
    content.append(
      element(
        'p',
        'No Engine request link was reported for this observation.',
        'muted small',
      ),
    );
  if (event?.kind.startsWith('voice.transcript.')) {
    const recorded = text(fields(event.content).text);
    content.append(
      recorded
        ? element('pre', recorded)
        : element(
            'p',
            'Transcript text requires an explicit recording.',
            'muted small',
          ),
    );
  }
  return {
    controls: controls.element,
    navigation,
    content,
    raw: event?.raw ?? { message: 'The selected event is no longer retained.' },
    rawTitle: 'Selected voice observation',
  };
}
