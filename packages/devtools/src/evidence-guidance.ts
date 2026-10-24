import { fields, type PanelEvidence } from './panel-model.js';

interface GuidanceItem {
  id: string;
  title: string;
  detail: string;
  nextStep?: string;
}

interface GuidanceInput {
  evidence: PanelEvidence;
  source: 'live' | 'recording' | 'imported';
  clientId: string;
  hiddenEvents?: number;
  requestFiltersActive?: boolean;
  collectionFilter?: boolean;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function eventCount(value: number, qualifier = ''): string {
  return `${value} ${qualifier ? `${qualifier} ` : ''}${value === 1 ? 'event' : 'events'}`;
}

export function evidenceGuidance(input: GuidanceInput) {
  const live = input.source === 'live';
  const scoped = (id: string | undefined) =>
    input.clientId === 'all' || id === input.clientId;
  const events = [
    ...input.evidence.events,
    ...(input.evidence.requestEvents ?? []),
    ...(input.evidence.transportHistory ?? []),
  ].filter((event) => scoped(event.clientId));
  const apps = input.evidence.apps
    .filter((app) => scoped(app.id))
    .map((app) => {
      const inspection = fields(app.inspection);
      const state = fields(inspection.snapshot ?? inspection);
      const connection =
        typeof state.connection === 'string' &&
        ['connected', 'connecting', 'disconnected', 'error'].includes(
          state.connection,
        )
          ? state.connection
          : undefined;
      const attached = live && app.active === true;
      return {
        id: app.id,
        attachment: !live
          ? 'Recorded app'
          : attached
            ? 'Attached'
            : app.active === false
              ? 'Ended, retained'
              : 'Attachment unknown',
        connection: connection
          ? `${attached ? 'Current' : 'Last retained'} Engine state: ${connection}`
          : 'Engine state not reported',
      };
    });
  const items: GuidanceItem[] = [];
  const hiddenEvents = count(input.hiddenEvents);
  if (hiddenEvents)
    items.push({
      id: 'filters',
      title: `${eventCount(hiddenEvents)} hidden by view filters`,
      detail:
        'These events remain retained in this source. View filters do not change a recording.',
      nextStep:
        'Reset event filters or choose All app instances to widen the view.',
    });
  else if (input.requestFiltersActive)
    items.push({
      id: 'filters',
      title: 'Request view filters are active',
      detail:
        'Search and issue categories can hide retained requests. They do not change a recording.',
      nextStep:
        'Clear the search and choose All issue categories to widen the view.',
    });
  if (live && input.collectionFilter)
    items.push({
      id: 'collection-filter',
      title: 'A collection filter is configured',
      detail:
        'The collector can exclude events before retention. Excluded events have no count here and cannot be restored by view filters.',
      nextStep:
        'Check the DevtoolsOptions.filter supplied by the application before reproducing the problem.',
    });
  if (live) {
    for (const [id, value, buffer, option] of [
      ['recent-loss', input.evidence.dropped, 'recent', 'maxActivityEvents'],
      [
        'request-loss',
        input.evidence.droppedRequestEvents,
        'request',
        'maxRequestEvents',
      ],
    ] as const) {
      const dropped = count(value);
      if (dropped)
        items.push({
          id,
          title: `${eventCount(dropped, buffer)} evicted`,
          detail:
            'This count is across this source, including other app instances. It does not identify which events or requests lost evidence.',
          nextStep: `Reproduce in a recording or increase ${option} before another run. Evicted events cannot be recovered.`,
        });
    }
  } else {
    const dropped = count(input.evidence.dropped);
    if (dropped === undefined || dropped > 0)
      items.push({
        id: 'capture-loss',
        title:
          dropped === undefined
            ? 'Recording loss count not reported'
            : `${eventCount(dropped, 'recording')} dropped`,
        detail:
          dropped === undefined
            ? 'Saved evidence does not establish whether the recording lost events.'
            : 'This count is across this source. Capture bounds or later redaction can discard events; the count does not locate the missing evidence.',
        nextStep:
          'For a new recording, check capture.maxEvents, capture.maxCharacters, and the redaction policy before reproducing the problem.',
      });
  }
  for (const [id, value, buffer] of [
    ['recent-view', input.evidence.omitted, live ? 'recent' : 'recorded'],
    ['request-view', input.evidence.omittedRequestEvents, 'request'],
  ] as const) {
    const omitted = count(value);
    if (omitted)
      items.push({
        id,
        title: `${eventCount(omitted, buffer)} omitted by the viewer`,
        detail:
          'The viewer limit applies across this source. These events are outside the displayed window; this count is separate from retention loss.',
        nextStep: live
          ? 'Read the collector getSnapshot() metadata outside the viewer window, or record a focused reproduction.'
          : 'Inspect an exported recording outside this viewer for earlier saved events.',
      });
  }
  if (apps.length === 0)
    items.push({
      id: 'attachment',
      title:
        live && input.clientId === 'all'
          ? 'No app instances attached'
          : 'No app state in the viewer window',
      detail:
        'App state is unavailable in this viewer window. Retained events may still be inspected.',
      nextStep:
        live && input.clientId === 'all'
          ? 'Install devtools() on the React instance, or attach the core collector before connecting the Orchestrator.'
          : 'Choose another app instance or inspect its retained events. Saved evidence cannot establish current attachment.',
    });
  const server = events.some((event) => event.kind.startsWith('engine.'));
  const voice = events.some((event) => event.kind.startsWith('voice.'));
  items.push(
    {
      id: 'server',
      title: server
        ? 'Server events retained'
        : 'No server events in the viewer window',
      detail: server
        ? 'These observations do not establish current forwarding permissions or complete server coverage.'
        : 'Forwarding setup is unknown. Earlier observations may be outside this window.',
      nextStep: server
        ? undefined
        : 'Check host diagnostics opt-in, createDiagnosticConnection, authorized session binding, and connector compatibility.',
    },
    {
      id: 'voice',
      title: voice
        ? 'Voice events retained'
        : 'No voice events in the viewer window',
      detail: voice
        ? 'These observations do not establish a current voice connection or provider support.'
        : 'Observation setup is unknown. Earlier observations may be outside this window.',
      nextStep: voice
        ? undefined
        : 'React realtime attaches diagnostics automatically. Other integrations use attachRealtimeDiagnostics.',
    },
    {
      id: 'content',
      title: live
        ? 'Live activity contains metadata only'
        : 'Recorded content is selective',
      detail: live
        ? 'Prompts, arguments, and other application content are absent from this feed, including while recording.'
        : 'Missing fields may be unrecorded, redacted, truncated, or unsupported. Saved evidence cannot identify every cause.',
      nextStep: live
        ? 'In Recordings, record the reproduction, then stop and inspect Current recording.'
        : 'For a new reproduction, record before the work starts. Earlier or removed content cannot be recovered.',
    },
    {
      id: 'support',
      title: 'Observation limits',
      detail:
        'Raw audio is excluded. Playback observations do not prove audibility. Only facts exposed by attached libraries are available.',
    },
  );
  return {
    source: live ? 'Live metadata' : 'Saved evidence · read-only',
    clientId: input.clientId,
    apps,
    items,
  };
}
