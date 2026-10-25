import {
  fields,
  identity,
  MAX_VIEW_EVENTS,
  type PanelEvent,
  type PanelEvidence,
} from './panel-model.js';

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

function voiceGuidance(input: GuidanceInput): GuidanceItem {
  const isVoice = (event: PanelEvent) =>
    (input.clientId === 'all' || event.clientId === input.clientId) &&
    event.kind.startsWith('voice.');
  const available = { id: 'voice', title: 'Voice observations available' };
  if (input.evidence.events.some(isVoice))
    return {
      ...available,
      detail:
        'These events describe observed voice activity. They do not prove a current voice connection.',
      nextStep:
        'Open Voice for the timeline. For raw events: Requests tab → All events in Activity view → Reset → Voice preset.',
    };
  let unlinked = false;
  for (const event of input.evidence.transportHistory ?? []) {
    if (!isVoice(event)) continue;
    unlinked = true;
    if (
      event.kind === 'voice.transport' &&
      event.clientId &&
      identity(event.metadata.providerInstanceId)
    )
      return {
        ...available,
        detail:
          'A transport observation is still available after leaving the recent-event window. It reports a past outcome; the current voice connection remains unknown.',
        nextStep:
          'Open Connections to inspect the saved transport outcome and any reported generation.',
      };
  }
  for (const event of input.evidence.requestEvents ?? []) {
    if (!isVoice(event)) continue;
    unlinked = true;
    if (event.clientId && event.requestId)
      return {
        ...available,
        detail:
          'Voice observations remain in request history after leaving the recent-event window. The reported request ID can help you find them.',
        nextStep: `Open Requests, choose Requests in Activity view, and search for a request ID starting with "${event.requestId.slice(0, 32)}".`,
      };
  }
  if (unlinked)
    return {
      id: 'voice',
      title: 'Voice metadata cannot be linked',
      detail:
        'An app, provider, or request identity is unavailable. These older observations are outside All events in Live activity.',
      nextStep:
        'If you recorded it here: Recordings → Stop if active → Inspect recording → All events in Activity view. Otherwise, record before the next reproduction.',
    };
  return {
    id: 'voice',
    title: 'No voice activity in this view',
    detail:
      'This selection has no voice observations in the viewer window. Voice support, connection state, and observation setup remain unknown.',
    nextStep:
      input.source === 'live'
        ? 'If you expected voice activity, open Setup guides → Voice diagnostics. React realtime attaches observation automatically; core integrations use attachRealtimeDiagnostics.'
        : (count(input.evidence.omitted) ?? 0) > 0
          ? 'Look for older voice events in the full recording JSON. Select Live activity to check current voice observations.'
          : 'Select Live activity to check current voice observations. For a new recording, record before reproducing the voice turn.',
  };
}

export function evidenceGuidance(input: GuidanceInput) {
  const live = input.source === 'live';
  const hasEarlierEvents = (count(input.evidence.omitted) ?? 0) > 0;
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
              ? 'No longer attached'
              : 'Attachment unknown',
        connection: connection
          ? `${attached ? 'Current' : 'Last observed'} Engine state: ${connection}`
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
        'These events are still available in the selected evidence source. Your search, app selection, or event filters hide them from the list.',
      nextStep:
        'Use Reset beside the event preset. Choose All app instances to include events from the other app lifetimes.',
    });
  else if (input.requestFiltersActive)
    items.push({
      id: 'filters',
      title: 'Request view filters are active',
      detail:
        'Search and issue categories limit the request list. Other requests may still be available in this evidence source.',
      nextStep:
        'Clear the search and choose All issue categories. Choose All app instances if you also want other app lifetimes.',
    });
  if (live && input.collectionFilter)
    items.push({
      id: 'collection-filter',
      title: 'Your app has a collection filter',
      detail:
        'DevtoolsOptions.filter can reject events before they reach live activity or recordings. Those exclusions have no count here.',
      nextStep:
        'Review the filter in your DevTools setup. Allow the event kinds you need, then reproduce the problem again.',
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
            'Older events were removed to make room for newer ones. This count covers all app instances and does not identify which requests lost events.',
          nextStep: `Check an existing recording for the incident. For the next run, increase ${option} or start recording before reproducing it.`,
        });
    }
  } else {
    const dropped = count(input.evidence.dropped);
    if (dropped === undefined || dropped > 0)
      items.push({
        id: 'capture-loss',
        title:
          dropped === undefined
            ? 'Recording completeness is unknown'
            : `${eventCount(dropped, 'recording')} dropped`,
        detail:
          dropped === undefined
            ? 'This recording does not report a dropped-event count. The saved events may be incomplete.'
            : 'Capture limits or later redaction can discard events. This count covers the whole recording and cannot identify which events are missing.',
        nextStep:
          dropped === undefined
            ? 'For another reproduction, make a new recording and check its dropped-event count before exporting.'
            : 'Before recording again, review capture.maxEvents, capture.maxCharacters, and your redaction policy. Dropped events cannot be recovered from this recording.',
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
        detail: `DevTools displays the latest ${MAX_VIEW_EVENTS.toLocaleString('en-US')} events. These earlier events remain in ${live ? 'the collector snapshot' : 'the selected recording'}.`,
        nextStep: live
          ? 'Read older metadata with getSnapshot() on the core collector. View filters search only the displayed event window.'
          : 'Open the full recording JSON to inspect the earlier events. View filters cannot bring them into this window.',
      });
  }
  if (apps.length === 0)
    items.push({
      id: 'attachment',
      title:
        live && input.clientId === 'all'
          ? 'No app attached to DevTools'
          : 'App snapshot unavailable in this view',
      detail: live
        ? input.clientId === 'all'
          ? 'The panel is open, but this collector has no attached app to inspect.'
          : 'No snapshot for this app lifetime is available. Its events may still be in Requests or All events.'
        : hasEarlierEvents
          ? 'The Inspector has no app snapshot in this viewer window. An earlier snapshot may still exist in the full recording.'
          : 'The Inspector cannot reconstruct an app from these events. A snapshot or app identity may be missing or redacted.',
      nextStep:
        live && input.clientId === 'all'
          ? 'Open Setup guides → App integration to attach the collector before the client connects. The guide covers React and core setup.'
          : live
            ? 'Choose another app instance to inspect its current state. For a new reproduction, keep DevTools attached before the app starts work.'
            : hasEarlierEvents
              ? 'Open the full recording JSON to look for earlier app snapshots.'
              : 'Make a new recording before the app changes. Check the Inspector before exporting if you need to compare app state.',
    });
  const server = events.some((event) => event.kind.startsWith('engine.'));
  items.push(
    {
      id: 'server',
      title: server
        ? 'Engine diagnostics available'
        : 'Planner details unavailable in this view',
      detail: server
        ? 'Use these observations to check planner work. Timings and usage may be unreported; current forwarding settings remain unknown.'
        : 'Without Engine events here, DevTools cannot explain planner attempts, validation decisions, or model usage. Forwarding setup is unknown.',
      nextStep: server
        ? 'Requests tab → Requests in Activity view → select a request → Planner evidence. For other events: All events → Reset → Engine preset.'
        : live
          ? 'Open Setup guides → Engine diagnostics to check forwarding on your development host, then send another request.'
          : hasEarlierEvents
            ? 'Open the full recording JSON to look for earlier Engine events. For a new recording, check Engine diagnostics forwarding before reproducing the request.'
            : 'For a new recording, check Engine diagnostics forwarding before reproducing the request.',
    },
    voiceGuidance(input),
    {
      id: 'content',
      title: live
        ? 'Prompts and arguments need a recording'
        : 'Some recorded content may be missing',
      detail: live
        ? 'Live activity shows metadata only, even while recording. Supported prompts, arguments, and transcripts are stored in the recording instead.'
        : 'Missing fields may be unrecorded, redacted, truncated, or unsupported. This recording cannot establish every reason a field is absent.',
      nextStep: live
        ? 'Open Recordings, start or continue the recording, reproduce the problem, then choose Stop and Inspect recording.'
        : 'Make a new recording from before the problem starts. Review your redaction policy before sharing the file.',
    },
    {
      id: 'support',
      title: 'Raw audio is not recorded',
      detail:
        'Raw audio is excluded. Playback events alone cannot confirm that anyone heard the response.',
      nextStep: 'Check audibility in the app.',
    },
  );
  return {
    source: live ? 'Live metadata' : 'Saved evidence · read-only',
    clientId: input.clientId,
    apps,
    items,
  };
}
