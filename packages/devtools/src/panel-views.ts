import {
  duration,
  eventLabel,
  type Fields,
  fields,
  groupRequests,
  humanize,
  identity,
  inspectState,
  list,
  numeric,
  type PanelApp,
  type PanelEvent,
  type PanelEvidence,
  type RequestStatus,
  statusLabels,
  text,
} from './panel-model.js';

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
export function button(
  label: string,
  click: () => void,
  className?: string,
): HTMLButtonElement {
  const node = element('button', label, className);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
}
export function badge(label: string, tone = 'neutral'): HTMLElement {
  const node = element('span', label, 'badge');
  node.dataset.tone = tone;
  return node;
}
export function factList(
  values: readonly (readonly [string, string])[],
): HTMLElement {
  const dl = element('dl', undefined, 'facts');
  for (const [key, value] of values) {
    const item = element('div');
    item.append(element('dt', key), element('dd', value));
    dl.append(item);
  }
  return dl;
}
function table(
  values: readonly (readonly [string, string])[],
): HTMLTableElement {
  const node = element('table', undefined, 'field-table'),
    body = element('tbody');
  for (const [key, value] of values) {
    const row = element('tr');
    const title = element('th', key);
    title.scope = 'row';
    row.append(title, element('td', value));
    body.append(row);
  }
  node.append(body);
  return node;
}
function empty(message: string): HTMLElement {
  return element('p', message, 'empty');
}
function date(value: unknown): string {
  const at = numeric(value);
  if (at === undefined) return 'Time not reported';
  const time = new Date(at);
  return Number.isNaN(time.getTime())
    ? 'Time not reported'
    : time.toLocaleTimeString();
}
function tone(status: RequestStatus): string {
  return status === 'failed'
    ? 'error'
    : status === 'applied'
      ? 'success'
      : ['applied-with-issues', 'discarded', 'abandoned'].includes(status)
        ? 'warning'
        : 'neutral';
}
function searchable(event: PanelEvent, query: string): boolean {
  return (
    !query ||
    `${event.kind} ${event.requestId ?? ''} ${JSON.stringify(event.metadata)}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
}

export interface ViewContext {
  evidence: PanelEvidence;
  appLabel(id: string): string;
  clientId: string;
  query: string;
  requestKey: string;
  eventKey: string;
  instanceKey: string;
  allEvents: boolean;
  pageSize: number;
  expandedRequest?: string;
  expandRequest(key?: string): void;
  live: boolean;
  inspect(app: PanelApp): unknown;
  selectRequest(key: string): void;
  selectEvent(key: string): void;
  selectInstance(clientId: string, instanceId: string): void;
  selectApp(clientId: string): void;
  more(): void;
}
export interface RenderedView {
  navigation?: HTMLElement;
  content: HTMLElement;
  raw: unknown;
  rawTitle: string;
  selectedInstance?: { clientId: string; instanceId: string };
  selectedRequestKey?: string;
  contentIdentity?: readonly unknown[];
}

function eventDetails(event: PanelEvent, context: ViewContext): HTMLElement {
  const detail = element('section');
  detail.append(element('h3', eventLabel(event)));
  detail.append(
    element(
      'p',
      `${event.clientId ? context.appLabel(event.clientId) : 'App identity not recorded'} · ${date(event.at)}`,
      'muted small',
    ),
  );
  const values: [string, string][] = [];
  for (const [key, value] of Object.entries(event.metadata)) {
    if (
      key === 'clientId' ||
      key === 'providerInstanceId' ||
      key === 'serverAt'
    )
      continue;
    values.push([
      humanize(key),
      key === 'durationMs'
        ? duration(value)
        : value === null || value === undefined
          ? 'Not reported'
          : String(value),
    ]);
  }
  if (values.length) detail.append(table(values));
  const instanceId = text(event.metadata.instanceId);
  const clientId = event.clientId;
  if (clientId && instanceId)
    detail.append(
      button('Inspect this Instance', () =>
        context.selectInstance(clientId, instanceId),
      ),
    );
  const error = text(fields(event.content).error);
  if (error) detail.append(element('p', error, 'warning'));
  else if (/failed|error/.test(event.kind))
    detail.append(
      element(
        'p',
        'Error content was not recorded. Start a recording before reproducing the problem to retain supported details.',
        'muted small',
      ),
    );
  if (numeric(event.metadata.serverAt) !== undefined)
    detail.append(
      element(
        'p',
        `Server emission: ${date(event.metadata.serverAt)}. Browser observation: ${date(event.at)}. These clocks are independent.`,
        'muted small',
      ),
    );
  return detail;
}

export function requestsView(context: ViewContext): RenderedView {
  const navigation = element('div'),
    content = element('section');
  const scoped = (
    context.allEvents
      ? context.evidence.events
      : (context.evidence.requestEvents ?? context.evidence.events)
  ).filter(
    (event) =>
      context.clientId === 'all' || event.clientId === context.clientId,
  );
  if (context.allEvents) {
    const events = scoped
      .filter((event) => searchable(event, context.query))
      .slice()
      .reverse();
    const selected =
      events.find((event) => event.key === context.eventKey) ?? events[0];
    for (const event of events.slice(0, context.pageSize)) {
      const row = button(
        '',
        () => context.selectEvent(event.key),
        'row-button',
      );
      row.dataset.focusKey = `event:${event.key}`;
      row.setAttribute('aria-pressed', String(selected?.key === event.key));
      row.append(
        element('span', eventLabel(event), 'row-title'),
        element(
          'span',
          `${event.clientId ? context.appLabel(event.clientId) : 'Uncorrelated'} · ${date(event.at)}`,
          'row-detail',
        ),
      );
      navigation.append(row);
    }
    if (events.length > context.pageSize)
      navigation.append(button('Show more events', context.more));
    if (!selected)
      content.append(
        empty(
          'No matching events. Use the application to generate activity, or open a recording.',
        ),
      );
    else content.append(eventDetails(selected, context));
    return {
      navigation,
      content,
      raw: selected?.raw,
      rawTitle: 'Selected event',
      contentIdentity: [
        'event',
        selected?.raw,
        context.clientId,
        ...context.evidence.apps.flatMap((app) => [app.id, app.active]),
      ],
    };
  }
  const requests = groupRequests(scoped).filter(
    (request) =>
      !context.query ||
      `${request.requestId} ${request.intent ?? ''} ${statusLabels[request.status]} ${context.appLabel(request.clientId)}`
        .toLowerCase()
        .includes(context.query.toLowerCase()) ||
      request.events.some((event) => searchable(event, context.query)),
  );
  const selected = context.requestKey
    ? requests.find((request) => request.key === context.requestKey)
    : requests[0];
  for (const request of requests.slice(0, context.pageSize)) {
    const row = button(
      '',
      () => context.selectRequest(request.key),
      'row-button',
    );
    row.dataset.focusKey = `request:${request.key}`;
    row.setAttribute('aria-pressed', String(selected?.key === request.key));
    const heading = element('span', undefined, 'row-heading');
    heading.append(
      element(
        'span',
        request.intent?.slice(0, 90) ??
          `${request.push ? 'Push response' : 'Request'} ${request.requestId.slice(0, 10)}`,
        'row-title',
      ),
    );
    row.append(
      heading,
      badge(statusLabels[request.status], tone(request.status)),
      element(
        'span',
        `${context.appLabel(request.clientId)} · ${duration(request.transportMs)}`,
        'row-detail',
      ),
    );
    navigation.append(row);
  }
  if (requests.length > context.pageSize)
    navigation.append(button('Show more requests', context.more));
  if (!selected) {
    content.append(
      empty(
        context.requestKey
          ? 'The selected request is no longer retained or does not match this view. Select another request from the list.'
          : scoped.length > 0
            ? 'No correlated requests match this view. Choose All events for connection, voice, and legacy recording evidence.'
            : 'No requests yet. Interact with your application to see how requests change its UI.',
      ),
    );
    return { navigation, content, raw: undefined, rawTitle: 'Selected event' };
  }
  content.append(
    badge(statusLabels[selected.status], tone(selected.status)),
    element(
      'h3',
      selected.intent ??
        `${selected.push ? 'Push response' : 'Request'} ${selected.requestId.slice(0, 12)}`,
    ),
  );
  const summary: Record<RequestStatus, string> = {
    awaiting: 'No client outcome has been observed yet.',
    received: 'The response arrived. UI application has not yet been observed.',
    applied: 'The client completed the response command batch.',
    'applied-with-issues':
      'The response batch completed with failed or skipped Actions.',
    failed: 'The client reported a request or response application failure.',
    discarded: 'The client discarded this response. Inspect its reason below.',
    abandoned: 'Client work ended before the response batch completed.',
  };
  content.append(element('p', summary[selected.status], 'muted'));
  if (selected.status === 'discarded' || selected.status === 'abandoned') {
    const reason = selected.events
      .slice()
      .reverse()
      .find((event) => text(event.metadata.reason));
    if (reason)
      content.append(
        element(
          'p',
          `Reason: ${humanize(String(reason.metadata.reason))}`,
          'warning',
        ),
      );
  }
  content.append(
    element(
      'p',
      `${selected.succeededActions} observed Actions succeeded · ${selected.observedFailedActions} failed · ${selected.observedSkippedActions} skipped`,
      'muted small',
    ),
  );
  const coverage = element('details', undefined, 'help');
  coverage.append(
    element('summary', 'Timings and evidence coverage'),
    factList([
      ['Transport', duration(selected.transportMs)],
      ['Observed command work', duration(selected.applicationMs)],
      [
        'Observed Actions · succeeded / failed / skipped',
        `${selected.succeededActions} / ${selected.observedFailedActions} / ${selected.observedSkippedActions}`,
      ],
      [
        'Reported failed / skipped',
        `${selected.failedActions ?? 'Unknown'} / ${selected.skippedActions ?? 'Unknown'}`,
      ],
    ]),
  );
  if (selected.missingStart)
    content.append(
      element(
        'p',
        'Partial evidence: the request start is not retained.',
        'warning',
      ),
    );
  if (selected.events.every((event) => !event.kind.startsWith('engine.')))
    coverage.append(
      element(
        'p',
        'No server stages are retained for this request. Server evidence requires a compatible, enabled host.',
        'muted small',
      ),
    );
  content.append(element('h3', 'Observed stages'));
  const current =
    selected.events.find((event) => event.key === context.eventKey) ??
    selected.events.at(-1);
  function timeline(events: readonly PanelEvent[]): HTMLElement {
    const list = element('ol', undefined, 'timeline');
    for (const event of events) {
      const item = element('li');
      const row = button('', () => context.selectEvent(event.key));
      row.dataset.focusKey = `stage:${event.key}`;
      row.setAttribute('aria-pressed', String(current?.key === event.key));
      row.append(element('span', eventLabel(event)));
      const bits = [
        event.kind.startsWith('engine.') ? 'Engine' : undefined,
        text(event.metadata.action),
        text(event.metadata.outcome),
        numeric(event.metadata.durationMs) === undefined
          ? undefined
          : duration(event.metadata.durationMs),
      ].filter(Boolean);
      if (bits.length)
        row.append(element('span', bits.join(' · '), 'stage-meta'));
      item.append(row);
      list.append(item);
    }
    return list;
  }
  const milestones = selected.events.filter(
    (event) =>
      [
        'client.request.started',
        'client.request.failed',
        'client.response.received',
        'client.response.applied',
        'client.response.failed',
        'client.response.discarded',
        'client.response.abandoned',
        'client.action.completed',
      ].includes(event.kind) ||
      (event.kind === 'client.command.completed' &&
        event.metadata.command === 'set_layout'),
  );
  const visibleMilestones = milestones.slice(0, 30);
  const terminal = milestones.at(-1);
  if (terminal && !visibleMilestones.includes(terminal))
    visibleMilestones.push(terminal);
  content.append(timeline(visibleMilestones));
  const additional = selected.events.filter(
    (event) => !visibleMilestones.includes(event),
  );
  if (additional.length) {
    const details = element('details', undefined, 'help');
    details.open =
      context.expandedRequest === selected.key ||
      Boolean(current && additional.includes(current) && context.eventKey);
    details.addEventListener('toggle', () => {
      if (details.isConnected)
        context.expandRequest(details.open ? selected.key : undefined);
    });
    details.append(
      element(
        'summary',
        `Queue, readiness, and Engine stages · ${additional.length}`,
      ),
      timeline(additional.slice(0, 200)),
    );
    if (additional.length > 200)
      details.append(
        element(
          'p',
          'Only the first 200 additional stages are shown. Use All events and the request filter to inspect the remaining evidence.',
          'muted small',
        ),
      );
    content.append(details);
  }
  coverage.append(
    element(
      'p',
      'An applied outcome means the client command batch finished. It does not establish a browser paint, animation completion, or audible playback. Timings come from their emitting process; command work excludes queue time.',
    ),
  );
  content.append(coverage);
  if (
    current &&
    (text(current.metadata.instanceId) || text(fields(current.content).error))
  )
    content.append(eventDetails(current, context));
  return {
    navigation,
    content,
    raw: current?.raw,
    rawTitle: 'Selected stage',
    selectedRequestKey: selected.key,
    contentIdentity: [
      'request',
      selected.key,
      context.eventKey,
      context.expandedRequest,
      context.clientId,
      ...selected.events.map((event) => event.raw),
      ...context.evidence.apps.flatMap((app) => [app.id, app.active]),
    ],
  };
}

export function inspectorView(context: ViewContext): RenderedView {
  const navigation = element('div'),
    content = element('section');
  const apps = context.evidence.apps.filter(
    (app) => context.clientId === 'all' || app.id === context.clientId,
  );
  if (apps.length > 1 && context.clientId === 'all') {
    content.append(
      element('h3', 'Choose an app instance'),
      element(
        'p',
        'Each app instance has its own Chart, registry, and retained state.',
        'muted',
      ),
    );
    for (const app of apps) {
      const row = button(
        `${context.appLabel(app.id)} · ${app.active === undefined ? 'recorded' : app.active ? 'active' : 'ended, retained'}`,
        () => context.selectApp(app.id),
        'row-button',
      );
      navigation.append(row);
    }
    return { navigation, content, raw: undefined, rawTitle: 'Selected state' };
  }
  const app = apps[0];
  if (!app) {
    content.append(
      empty(
        'No app state is available. Older recordings may contain events without structural snapshots.',
      ),
    );
    return { content, raw: undefined, rawTitle: 'Selected state' };
  }
  const inspection = context.inspect(app),
    state = inspectState(inspection);
  const instances = state.instances;
  const selected =
    instances.find(
      (instance) =>
        JSON.stringify([app.id, instance.instanceId]) === context.instanceKey,
    ) ?? instances[0];
  navigation.append(element('h3', 'Instances'));
  for (const instance of instances.slice(0, context.pageSize)) {
    const key = JSON.stringify([app.id, instance.instanceId]);
    const row = button(
      '',
      () => context.selectInstance(app.id, instance.instanceId),
      'row-button',
    );
    row.dataset.focusKey = `instance:${key}`;
    row.setAttribute(
      'aria-pressed',
      String(selected?.instanceId === instance.instanceId),
    );
    row.append(
      element(
        'span',
        instance.vesselName ?? instance.vesselId ?? instance.instanceId,
        'row-title',
      ),
      element(
        'span',
        `${instance.variant ?? 'Variant unavailable'} · ${instance.visible === undefined ? 'visibility unknown' : instance.visible ? 'visible' : 'hidden by layout'}`,
        'row-detail',
      ),
    );
    navigation.append(row);
  }
  if (instances.length > context.pageSize)
    navigation.append(button('Show more Instances', context.more));
  content.append(
    element('h3', `${context.appLabel(app.id)} · Chart`),
    element(
      'p',
      `${text(state.layout.type) ? humanize(String(state.layout.type)) : 'Layout unavailable'} · ${state.columns ?? '?'} columns × ${state.rows ?? '?'} rows · schematic preview`,
      'muted small',
    ),
  );
  if (state.tiles !== null && state.tiles.length > 0) {
    const map = element('div', undefined, 'minimap');
    map.setAttribute('aria-label', 'Chart layout preview');
    for (const tile of state.tiles.slice(0, 200)) {
      const instance = instances.find(
        (instance) => instance.instanceId === tile.instanceId,
      );
      const node = button(
        '',
        () => context.selectInstance(app.id, tile.instanceId),
        'tile',
      );
      node.dataset.focusKey = `tile:${app.id}:${tile.instanceId}`;
      node.dataset.instanceId = tile.instanceId;
      node.setAttribute(
        'aria-label',
        `Inspect ${instance?.vesselName ?? instance?.vesselId ?? 'Instance'} ${tile.instanceId}`,
      );
      node.setAttribute(
        'aria-pressed',
        String(selected?.instanceId === tile.instanceId),
      );
      Object.assign(node.style, {
        left: `${tile.x}%`,
        top: `${tile.y}%`,
        width: `${tile.width}%`,
        height: `${tile.height}%`,
      });
      node.append(
        element(
          'span',
          instance?.vesselName ?? instance?.vesselId ?? 'Unknown Instance',
        ),
        element('small', instance?.variant ?? tile.instanceId),
      );
      map.append(node);
    }
    content.append(map);
    if (state.tiles.length > 200)
      content.append(
        element(
          'p',
          'The diagram shows the first 200 tiles. Select an Instance from the list for details.',
          'warning',
        ),
      );
  } else
    content.append(
      element(
        'p',
        state.tiles === null
          ? 'A trustworthy layout diagram is unavailable. Instance details and JSON remain accessible.'
          : 'The layout has no visible Instance leaves.',
        'muted',
      ),
    );
  if (selected) {
    content.append(
      element(
        'h3',
        selected.vesselName ?? selected.vesselId ?? selected.instanceId,
      ),
    );
    const size = selected.minSize;
    content.append(
      table([
        ['Vessel', selected.vesselId ?? 'Not retained'],
        ['Variant', selected.variant ?? 'Not retained'],
        [
          'Visibility',
          selected.visible === undefined
            ? 'Not established'
            : selected.visible
              ? 'Visible in layout'
              : 'Retained, hidden by layout',
        ],
        [
          'Declared minimum',
          numeric(size.width) !== undefined &&
          numeric(size.height) !== undefined
            ? `${size.width} × ${size.height} cells`
            : 'Not retained',
        ],
      ]),
    );
    const capabilities = element('section', undefined, 'capability');
    capabilities.append(element('h3', 'Registered Actions'));
    if (!selected.actions.length)
      capabilities.append(
        element(
          'p',
          Array.isArray(
            fields(fields(selected.definition.variants)[selected.variant ?? ''])
              .actions,
          )
            ? 'No Actions are declared for this Variant.'
            : 'Action definitions were not retained. Live inspection or a recording baseline is needed.',
          'muted small',
        ),
      );
    for (const action of selected.actions) {
      capabilities.append(
        element('p', text(action.name) ?? 'Unnamed Action', 'mono'),
      );
      if (text(action.description))
        capabilities.append(
          element('p', String(action.description), 'muted small'),
        );
    }
    content.append(capabilities);
    const technical = element('details', undefined, 'technical');
    technical.append(
      element('summary', 'Instance identity'),
      element('p', selected.instanceId, 'mono'),
    );
    content.append(technical);
  }
  const registry = element('details', undefined, 'help');
  registry.append(
    element('summary', `Registered Vessels · ${state.vessels.length}`),
  );
  for (const vessel of state.vessels) {
    registry.append(
      element('h3', text(vessel.name) ?? text(vessel.id) ?? 'Vessel'),
    );
    const variants = Array.isArray(vessel.variants)
      ? list(vessel.variants)
          .filter((value) => typeof value === 'string')
          .join(', ')
      : Object.keys(fields(vessel.variants)).join(', ');
    registry.append(
      element('p', `Variants: ${variants || 'Not retained'}`, 'muted small'),
    );
  }
  if (!state.vessels.length)
    registry.append(
      element(
        'p',
        'Registry definitions are not available in this evidence.',
        'muted',
      ),
    );
  content.append(registry);
  return {
    navigation,
    content,
    raw: selected
      ? {
          instance: selected.raw,
          vessel: selected.definition,
          layout: state.layout,
        }
      : inspection,
    rawTitle: 'Selected Instance and definition',
    selectedInstance: selected
      ? { clientId: app.id, instanceId: selected.instanceId }
      : undefined,
  };
}

export function connectionsView(
  context: ViewContext,
  history: readonly PanelEvent[],
): RenderedView {
  const content = element('section'),
    grid = element('div', undefined, 'connections-grid');
  const apps = context.evidence.apps.filter(
    (app) => context.clientId === 'all' || app.id === context.clientId,
  );
  const events = context.evidence.events.filter(
    (event) =>
      context.clientId === 'all' || event.clientId === context.clientId,
  );
  for (const app of apps) {
    const state = inspectState(app.inspection),
      recent = events
        .filter(
          (event) =>
            event.clientId === app.id &&
            event.kind === 'client.connection.changed',
        )
        .at(-1);
    const connection = element('section', undefined, 'connection');
    connection.append(
      element('h3', `${context.appLabel(app.id)} · Engine`),
      badge(
        (context.live
          ? (state.connection ?? text(recent?.metadata.status))
          : (text(recent?.metadata.status) ?? state.connection)) ??
          'Not reported',
      ),
    );
    const attempts = events.filter(
      (event) =>
        event.clientId === app.id && event.kind === 'client.connection.attempt',
    ).length;
    connection.append(
      factList([
        [
          'App lifetime',
          app.active === undefined
            ? 'Recorded evidence'
            : app.active
              ? 'Active'
              : 'Ended, retained',
        ],
        ['Observed connection attempts', String(attempts)],
      ]),
    );
    grid.append(connection);
  }
  const voices = new Map<string, { event: PanelEvent; metadata: Fields }>();
  for (const event of [...history, ...events]) {
    if (
      !event.kind.startsWith('voice.') ||
      !event.clientId ||
      (context.clientId !== 'all' && event.clientId !== context.clientId)
    )
      continue;
    const provider = identity(event.metadata.providerInstanceId);
    if (!provider) continue;
    const connectionFact =
      event.kind === 'voice.transport' ||
      event.kind === 'voice.observations' ||
      [
        'voice.session.started',
        'voice.session.connected',
        'voice.session.disconnecting',
        'voice.session.disconnected',
        'voice.session.error',
      ].includes(event.kind);
    if (
      !connectionFact &&
      numeric(
        event.metadata.providerGeneration ?? event.metadata.generation,
      ) === undefined
    )
      continue;
    const key = JSON.stringify([
      event.clientId,
      provider,
      event.metadata.providerGeneration !== undefined
        ? 'provider'
        : (event.metadata.generationScope ?? 'legacy'),
      event.metadata.providerGeneration ?? event.metadata.generation ?? null,
    ]);
    const metadata = { ...voices.get(key)?.metadata, ...event.metadata };
    if (event.kind === 'voice.transport' && text(event.metadata.state))
      metadata.transportState = event.metadata.state;
    const lifecycle: Record<string, string> = {
      'voice.session.started': 'connecting',
      'voice.session.connected': 'connected',
      'voice.session.disconnecting': 'disconnecting',
      'voice.session.disconnected': 'disconnected',
      'voice.session.error': 'error',
    };
    if (lifecycle[event.kind]) metadata.connection = lifecycle[event.kind];
    voices.set(key, { event, metadata });
  }
  for (const observation of [...voices.values()].slice(-16).reverse()) {
    const event = observation.event;
    const clientId = event.clientId;
    if (!clientId) continue;
    const connection = element('section', undefined, 'connection');
    const meta = observation.metadata;
    connection.append(
      element(
        'h3',
        `${context.appLabel(clientId)} · ${humanize(text(meta.provider) ?? 'Voice')}`,
      ),
      badge(
        text(meta.connection) ??
          text(meta.transportState) ??
          'State not reported',
      ),
    );
    const values: [string, string][] = [
      [
        meta.providerGeneration !== undefined
          ? 'Provider generation'
          : meta.generationScope === 'session'
            ? 'Session generation'
            : 'Generation',
        numeric(meta.providerGeneration ?? meta.generation)?.toString() ??
          'Not reported',
      ],
    ];
    for (const key of [
      'model',
      'transportState',
      'microphone',
      'planning',
      'applying',
      'playback',
      'playbackState',
      'finalization',
      'usageSeconds',
      'finalUsageSeconds',
      'contextUsageRatio',
    ])
      if (meta[key] !== undefined && meta[key] !== null)
        values.push([humanize(key), String(meta[key])]);
    connection.append(table(values));
    grid.append(connection);
  }
  if (!apps.length && !voices.size)
    grid.append(
      empty('No connection evidence is available for this selection.'),
    );
  content.append(grid);
  if (!voices.size)
    content.append(
      element(
        'p',
        'No voice metadata is retained. Voice is optional and remains separate from the app-instance selector.',
        'muted small',
      ),
    );
  content.append(element('h3', 'Recent connection and voice observations'));
  for (const event of events
    .filter(
      (event) =>
        event.kind.startsWith('voice.') ||
        event.kind.startsWith('client.connection.'),
    )
    .slice(-15)
    .reverse()) {
    const row = button(
      `${eventLabel(event)} · ${date(event.at)}`,
      () => context.selectEvent(event.key),
      'row-button',
    );
    row.dataset.focusKey = `connection:${event.key}`;
    content.append(row);
  }
  const selected = events.find((event) => event.key === context.eventKey);
  return {
    content,
    raw: selected?.raw ?? {
      connections: apps.map((app) => ({
        appInstance: context.appLabel(app.id),
        state: inspectState(app.inspection).connection ?? null,
      })),
      voice: [...voices.values()].map((observation) => ({
        ...observation.metadata,
        latestObservation: observation.event.raw,
      })),
    },
    rawTitle: selected
      ? 'Selected connection observation'
      : 'Connection evidence',
  };
}
