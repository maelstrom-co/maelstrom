import { expect, test } from 'bun:test';
import {
  evidenceGuidance,
  MAX_VIEW_EVENTS,
  type PanelEvidence,
  panelEvents,
  recordingEvidence,
} from './panel-model.js';

function evidence(events: unknown[] = []): PanelEvidence {
  return {
    events: panelEvents(events),
    apps: [],
    omitted: 0,
    metadata: {},
  };
}

function event(kind: string, clientId = 'app-a') {
  return { kind, metadata: { clientId }, id: crypto.randomUUID() };
}

test('older voice observations point to a view that can inspect the available evidence', () => {
  const data = evidence();
  data.transportHistory = panelEvents([
    {
      ...event('voice.transport'),
      metadata: { clientId: 'app-a', providerInstanceId: 'provider' },
    },
  ]);
  const transport = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
  });
  expect(
    transport.items.find((item) => item.id === 'voice')?.nextStep,
  ).toContain('Connections');
  data.transportHistory = [];
  data.requestEvents = panelEvents([
    { ...event('voice.tool.result'), requestId: 'linked-request' },
  ]);
  const request = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
  });
  expect(request.items.find((item) => item.id === 'voice')?.nextStep).toContain(
    'Requests in Activity view',
  );
  expect(request.items.find((item) => item.id === 'voice')?.nextStep).toContain(
    'linked-request',
  );
  data.requestEvents = panelEvents([
    { ...event('engine.planner.started'), requestId: 'linked-request' },
  ]);
  const engine = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
  });
  expect(engine.items.find((item) => item.id === 'server')?.nextStep).toContain(
    'Requests in Activity view',
  );
});

test('older voice metadata with redacted identity explains the grouping limit instead of promising a connection card', () => {
  const data = evidence();
  data.transportHistory = panelEvents([
    {
      ...event('voice.transport'),
      metadata: { clientId: 'app-a', providerInstanceId: '[REDACTED]' },
    },
  ]);
  const result = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
  });
  const voice = result.items.find((item) => item.id === 'voice');
  expect(voice?.title).toBe('Voice metadata cannot be linked');
  expect(voice?.detail).toContain('identity');
  expect(voice?.nextStep).toContain('If you recorded it here');
  expect(voice?.nextStep).toContain('Inspect recording');
  expect(voice?.nextStep).toContain('All events in Activity view');
  expect(voice?.nextStep).not.toContain('Open Connections');
});

test('saved gaps point to existing JSON before asking for another recording when older entries are outside the viewer', () => {
  const data = evidence();
  data.dropped = 0;
  const current = evidenceGuidance({
    evidence: data,
    source: 'imported',
    clientId: 'all',
  });
  for (const id of ['attachment', 'server', 'voice']) {
    expect(current.items.find((item) => item.id === id)?.nextStep).toContain(
      'new recording',
    );
  }
  data.omitted = 1;
  const earlier = evidenceGuidance({
    evidence: data,
    source: 'imported',
    clientId: 'all',
  });
  for (const id of ['attachment', 'server', 'voice']) {
    expect(earlier.items.find((item) => item.id === id)?.nextStep).toContain(
      'JSON',
    );
  }
});

test('viewer omissions cannot turn earlier retained server or voice observations into claims that collection retained none', () => {
  const data = recordingEvidence({
    events: [
      event('engine.planner.started'),
      event('voice.transport'),
      ...Array.from({ length: MAX_VIEW_EVENTS }, () =>
        event('client.request.completed'),
      ),
    ],
    droppedEvents: 0,
  });
  expect(data.omitted).toBe(2);
  const result = evidenceGuidance({
    evidence: data,
    source: 'imported',
    clientId: 'app-a',
  });
  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'server',
        title: 'Planner details unavailable in this view',
      }),
      expect.objectContaining({
        id: 'voice',
        title: 'No voice activity in this view',
      }),
    ]),
  );
});

test('an empty live feed offers setup checks without claiming voice or server collection is disabled', () => {
  const result = evidenceGuidance({
    evidence: evidence(),
    source: 'live',
    clientId: 'all',
  });
  expect(result.source).toBe('Live metadata');
  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'attachment',
        title: 'No app attached to DevTools',
        nextStep: expect.stringContaining('attach'),
      }),
      expect.objectContaining({
        id: 'server',
        title: 'Planner details unavailable in this view',
        detail: expect.stringContaining('Forwarding setup is unknown'),
        nextStep: expect.stringContaining('Engine diagnostics'),
      }),
      expect.objectContaining({
        id: 'voice',
        title: 'No voice activity in this view',
        detail: expect.stringContaining('observation setup remain unknown'),
        nextStep: expect.stringContaining('attachRealtimeDiagnostics'),
      }),
    ]),
  );
});

test('an expired app selection and redacted connection state remain unknown instead of borrowing another app', () => {
  const data = evidence([event('engine.planner.started', 'app-b')]);
  data.apps = [
    { id: 'app-b', active: true, inspection: { connection: '[REDACTED]' } },
  ];
  const expired = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
  });
  expect(expired.apps).toEqual([]);
  expect(expired.items).toContainEqual(
    expect.objectContaining({
      id: 'attachment',
      title: 'App snapshot unavailable in this view',
    }),
  );
  expect(expired.items).toContainEqual(
    expect.objectContaining({
      id: 'server',
      title: 'Planner details unavailable in this view',
    }),
  );
  const redacted = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-b',
  });
  expect(redacted.apps[0].connection).toBe('Engine state not reported');
  const legacy = evidenceGuidance({
    evidence: evidence(),
    source: 'imported',
    clientId: 'all',
  });
  expect(legacy.items).toContainEqual(
    expect.objectContaining({
      id: 'capture-loss',
      title: 'Recording completeness is unknown',
    }),
  );
  const knownZero = evidence();
  knownZero.dropped = 0;
  expect(
    evidenceGuidance({
      evidence: knownZero,
      source: 'imported',
      clientId: 'all',
    }).items.some((item) => item.id === 'capture-loss'),
  ).toBe(false);
});

test('saved evidence describes recorded state and never presents attachment or missing content as current configuration', () => {
  const data = evidence([event('voice.transport')]);
  data.apps = [
    {
      id: 'app-a',
      active: true,
      inspection: { snapshot: { connection: 'connected' } },
    },
  ];
  for (const source of ['recording', 'imported'] as const) {
    const result = evidenceGuidance({
      evidence: data,
      source,
      clientId: 'all',
    });
    expect(result.source).toBe('Saved evidence · read-only');
    expect(result.apps).toEqual([
      {
        id: 'app-a',
        attachment: 'Recorded app',
        connection: 'Last observed Engine state: connected',
      },
    ]);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: 'content',
        title: 'Some recorded content may be missing',
        detail: expect.stringContaining(
          'unrecorded, redacted, truncated, or unsupported',
        ),
      }),
    );
  }
  const emptyImport = evidenceGuidance({
    evidence: evidence(),
    source: 'imported',
    clientId: 'all',
  });
  expect(emptyImport.items).toContainEqual(
    expect.objectContaining({
      id: 'attachment',
      title: 'App snapshot unavailable in this view',
    }),
  );
  expect(
    emptyImport.items.find((item) => item.id === 'attachment')?.nextStep,
  ).toContain('Make a new recording');
});

test('view filtering, collector eviction, and viewer omissions remain separate source-wide facts', () => {
  const data = evidence([event('engine.planner.started')]);
  data.dropped = 3;
  data.droppedRequestEvents = 7;
  data.omitted = 2;
  data.omittedRequestEvents = 4;
  const result = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
    hiddenEvents: 1,
    collectionFilter: true,
  });
  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'filters',
        title: '1 event hidden by view filters',
      }),
      expect.objectContaining({
        id: 'recent-loss',
        title: '3 recent events evicted',
        detail: expect.stringContaining('all app instances'),
      }),
      expect.objectContaining({
        id: 'request-loss',
        title: '7 request events evicted',
        detail: expect.stringContaining('all app instances'),
      }),
      expect.objectContaining({
        id: 'recent-view',
        title: '2 recent events omitted by the viewer',
      }),
      expect.objectContaining({
        id: 'request-view',
        title: '4 request events omitted by the viewer',
      }),
      expect.objectContaining({
        id: 'collection-filter',
        title: 'Your app has a collection filter',
      }),
      expect.objectContaining({
        id: 'server',
        title: 'Engine diagnostics available',
      }),
    ]),
  );
  const saved = evidenceGuidance({
    evidence: data,
    source: 'recording',
    clientId: 'all',
    collectionFilter: true,
  });
  expect(saved.items.some((item) => item.id === 'collection-filter')).toBe(
    false,
  );
  expect(saved.items).toContainEqual(
    expect.objectContaining({
      id: 'capture-loss',
      title: '3 recording events dropped',
    }),
  );
  expect(
    saved.items.some(
      (item) => item.id === 'recent-loss' || item.id === 'request-loss',
    ),
  ).toBe(false);
});

test('setup observations follow the selected app, including server evidence retained outside recent activity', () => {
  const data = evidence([event('voice.transport', 'app-b')]);
  data.requestEvents = panelEvents([event('engine.planner.started')]);
  data.apps = [
    { id: 'app-a', active: true, inspection: { connection: 'connected' } },
    { id: 'app-b', active: false, inspection: { connection: 'connected' } },
  ];
  const a = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-a',
  });
  expect(a.apps).toEqual([
    {
      id: 'app-a',
      attachment: 'Attached',
      connection: 'Current Engine state: connected',
    },
  ]);
  expect(a.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'server',
        title: 'Engine diagnostics available',
      }),
      expect.objectContaining({
        id: 'voice',
        title: 'No voice activity in this view',
      }),
    ]),
  );
  const b = evidenceGuidance({
    evidence: data,
    source: 'live',
    clientId: 'app-b',
  });
  expect(b.apps).toEqual([
    {
      id: 'app-b',
      attachment: 'No longer attached',
      connection: 'Last observed Engine state: connected',
    },
  ]);
  expect(b.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'server',
        title: 'Planner details unavailable in this view',
      }),
      expect.objectContaining({
        id: 'voice',
        title: 'Voice observations available',
      }),
    ]),
  );
});
