import { expect, test } from 'bun:test';
import { panelEvents, voiceTimeline } from './panel-model.js';

function observation(
  kind: string,
  metadata: Record<string, unknown> = {},
  requestId?: string,
) {
  return {
    id: crypto.randomUUID(),
    kind,
    at: 100,
    sessionId: 'session',
    requestId,
    metadata: {
      clientId: 'app',
      provider: 'live',
      providerInstanceId: 'provider-a',
      generation: 1,
      generationScope: 'session',
      ...metadata,
    },
  };
}

test('voice lanes keep app lifetimes and independent generation counters apart', () => {
  const lanes = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.called', {
        invocationId: 'one',
        callId: 'reused',
      }),
      observation('voice.tool.result', {
        invocationId: 'one',
        callId: 'reused',
      }),
      observation('voice.tool.called', {
        generation: 2,
        invocationId: 'two',
        callId: 'reused',
      }),
      observation('voice.provider.wire', {
        generation: undefined,
        generationScope: undefined,
        providerGeneration: 1,
        responseId: 'response',
      }),
      observation('voice.tool.called', {
        providerInstanceId: 'provider-b',
        invocationId: 'three',
        callId: 'reused',
      }),
      observation('voice.tool.called', {
        clientId: 'other-app',
        invocationId: 'four',
        callId: 'reused',
      }),
    ]),
  });

  expect(
    lanes.map((lane) => [
      lane.clientId,
      lane.providerInstanceId,
      lane.scope,
      lane.generation,
      lane.events.length,
    ]),
  ).toEqual([
    ['app', 'provider-a', 'session', 1, 2],
    ['app', 'provider-a', 'session', 2, 1],
    ['app', 'provider-a', 'provider', 1, 1],
    ['app', 'provider-b', 'session', 1, 1],
    ['other-app', 'provider-a', 'session', 1, 1],
  ]);
});

test('only invocation identity joins reused tool IDs and proves related request ownership', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.called', {
        invocationId: 'first',
        callId: 'reused',
      }),
      observation('voice.tool.called', {
        invocationId: 'second',
        callId: 'reused',
      }),
      observation(
        'voice.tool.result',
        { invocationId: 'second', callId: 'reused' },
        'request-second',
      ),
      observation(
        'voice.tool.result',
        { invocationId: 'first', callId: 'reused' },
        'request-first',
      ),
      observation('voice.tool.called', { callId: 'unproven' }),
      observation('voice.tool.result', { callId: 'unproven' }),
    ]),
    requestEvents: panelEvents([
      observation('client.response.applied', {}, 'request-first'),
      observation(
        'client.response.applied',
        { clientId: 'other-app' },
        'request-second',
      ),
    ]),
  });

  expect(
    lane.groups.map((group) => [
      group.type,
      group.events.map((event) => event.kind),
    ]),
  ).toEqual([
    ['invocation', ['voice.tool.called', 'voice.tool.result']],
    ['invocation', ['voice.tool.called', 'voice.tool.result']],
    ['unlinked', ['voice.tool.called']],
    ['unlinked', ['voice.tool.result']],
  ]);
  expect(lane.groups[0].requests).toEqual([
    {
      key: JSON.stringify(['app', 'request-first']),
      requestId: 'request-first',
      state: 'available',
    },
  ]);
  expect(lane.groups[1].requests).toEqual([
    {
      requestId: 'request-second',
      state: 'unavailable',
      reason: 'not-retained',
    },
  ]);
});

test('a redactor collapsing invocation IDs cannot attach one request to another tool call', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.called', {
        invocationId: 'collapsed',
        callId: 'reused',
      }),
      observation('voice.tool.called', {
        invocationId: 'collapsed',
        callId: 'reused',
      }),
      observation(
        'voice.tool.result',
        { invocationId: 'collapsed', callId: 'reused' },
        'first',
      ),
      observation(
        'voice.tool.result',
        { invocationId: 'collapsed', callId: 'reused' },
        'second',
      ),
    ]),
  });

  expect(lane.groups.map((group) => group.type)).toEqual([
    'unlinked',
    'unlinked',
    'unlinked',
    'unlinked',
  ]);
  expect(
    lane.groups.slice(0, 2).every((group) => group.requests.length === 0),
  ).toBe(true);
});

test.each([
  'clientId',
  'providerInstanceId',
  'generation',
])('missing or redacted %s never establishes tool ownership', (field) => {
  const lanes = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.called', {
        [field]: '[REDACTED]',
        invocationId: 'same',
      }),
      observation('voice.tool.result', {
        [field]: '[REDACTED]',
        invocationId: 'same',
      }),
    ]),
  });
  expect(
    lanes.flatMap((lane) => lane.groups).map((group) => group.type),
  ).toEqual(['unlinked', 'unlinked']);
});

test('provider responses stay in their native generation and retain cancellation without matching session tool IDs', () => {
  const lanes = voiceTimeline({
    events: panelEvents([
      {
        ...observation('voice.provider.wire', {
          providerGeneration: 1,
          responseId: 'same',
          callId: 'call',
          responsePhase: 'started',
          eventType: 'response.created',
        }),
        at: 9000,
      },
      {
        ...observation('voice.provider.wire', {
          providerGeneration: 1,
          responseId: 'same',
          callId: 'call',
          responsePhase: 'finished',
          eventType: 'response.done',
          status: 'cancelled',
        }),
        at: 1,
      },
      observation('voice.provider.wire', {
        providerGeneration: 2,
        responseId: 'same',
        responsePhase: 'observed',
      }),
      observation('voice.tool.called', {
        invocationId: 'same',
        callId: 'call',
      }),
    ]),
  });
  expect(
    lanes.map((lane) => [
      lane.scope,
      lane.generation,
      lane.groups[0].type,
      lane.groups[0].events.length,
    ]),
  ).toEqual([
    ['provider', 1, 'response', 2],
    ['provider', 2, 'response', 1],
    ['session', 1, 'invocation', 1],
  ]);
  expect(lanes[0].events.map((event) => event.at)).toEqual([9000, 1]);
  expect(lanes[0].groups[0].events[1].metadata.status).toBe('cancelled');
  expect(lanes[2].groups[0].requests).toEqual([]);
});

test('request history supplies related evidence without fabricating an order for evicted voice activity', () => {
  const lanes = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    ]),
    requestEvents: panelEvents([
      observation('voice.tool.called', { invocationId: 'one' }, 'request'),
      observation('client.response.applied', {}, 'request'),
    ]),
  });
  expect(lanes[0].events.map((event) => event.kind)).toEqual([
    'voice.tool.result',
  ]);
  expect(lanes[0].groups[0].requests[0].state).toBe('available');
});

test('request-link availability follows the Requests buffer when activity outlives it', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('client.request.started', {}, 'old'),
      observation('voice.tool.result', { invocationId: 'one' }, 'old'),
    ]),
    requestEvents: panelEvents([
      observation('client.request.started', {}, 'new'),
    ]),
  });
  expect(lane.groups[0].requests[0]).toMatchObject({
    state: 'unavailable',
    reason: 'not-retained',
  });
});

test('colliding native response lifecycles remain unlinked after redaction', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'collapsed',
        responsePhase: 'started',
        eventType: 'response.created',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'collapsed',
        responsePhase: 'started',
        eventType: 'response.created',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'collapsed',
        responsePhase: 'finished',
        eventType: 'response.done',
        status: 'completed',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'collapsed',
        responsePhase: 'finished',
        eventType: 'response.done',
        status: 'cancelled',
      }),
    ]),
  });
  expect(lane.groups.map((group) => group.type)).toEqual([
    'unlinked',
    'unlinked',
    'unlinked',
    'unlinked',
  ]);
});

test('conflicting tool names disprove a collapsed invocation identity', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.called', {
        invocationId: 'collapsed',
        callId: 'reused',
        tool: 'get_ui_state',
      }),
      observation(
        'voice.tool.result',
        { invocationId: 'collapsed', callId: 'reused', tool: 'update_ui' },
        'other',
      ),
    ]),
  });
  expect(lane.groups.map((group) => group.type)).toEqual([
    'unlinked',
    'unlinked',
  ]);
  expect(lane.groups[0].requests).toEqual([]);
});

test.each([
  'session',
  'provider',
] as const)('contradictory %s context cannot join projected lifetime collisions', (field) => {
  const first = observation('voice.tool.called', {
    invocationId: 'collapsed',
    callId: 'reused',
    provider: 'live',
  });
  const second = {
    ...observation(
      'voice.tool.result',
      {
        invocationId: 'collapsed',
        callId: 'reused',
        provider: field === 'provider' ? 'livekit' : 'live',
      },
      'other-request',
    ),
    sessionId: field === 'session' ? 'other-session' : 'session',
  };
  const lanes = voiceTimeline({ events: panelEvents([first, second]) });
  expect(
    lanes.flatMap((lane) => lane.groups).map((group) => group.type),
  ).toEqual(['unlinked', 'unlinked']);
  expect(lanes[0].groups[0].requests).toEqual([]);
});

test('a projected request-key collision cannot navigate into contradictory retained app sessions', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    ]),
    requestEvents: panelEvents([
      {
        ...observation('client.response.applied', {}, 'request'),
        sessionId: 'other-session',
      },
    ]),
  });
  expect(lane.groups[0].requests[0]).toMatchObject({
    state: 'unavailable',
    reason: 'ambiguous',
  });
});

test.each([
  ['repeated starts', ['client.request.started', 'client.request.started']],
  [
    'completed lifecycles',
    [
      'client.request.started',
      'client.response.applied',
      'client.request.started',
      'client.response.applied',
    ],
  ],
  [
    'abandoned responses',
    ['client.response.abandoned', 'client.response.abandoned'],
  ],
  [
    'different terminal outcomes',
    ['client.request.failed', 'client.response.applied'],
  ],
  [
    'a start after an evicted lifecycle',
    ['client.response.applied', 'client.request.started'],
  ],
] as const)('Voice rejects a same-session request collision with %s', (_name, kinds) => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    ]),
    requestEvents: panelEvents(
      kinds.map((kind) => observation(kind, {}, 'request')),
    ),
  });
  expect(lane.groups[0].requests[0]).toMatchObject({
    state: 'unavailable',
    reason: 'ambiguous',
  });
});

test.each([
  'client.response.applied',
  'client.request.failed',
  'client.response.failed',
  'client.response.discarded',
  'client.response.abandoned',
])('one %s lifecycle remains navigable with repeated references and nested work', (terminal) => {
  const start = observation('client.request.started', {}, 'request');
  const end = observation(terminal, {}, 'request');
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    ]),
    requestEvents: panelEvents([
      start,
      start,
      observation('engine.request.completed', {}, 'request'),
      observation('engine.stage.completed', {}, 'request'),
      observation('engine.stage.completed', {}, 'request'),
      observation('client.action.completed', {}, 'request'),
      observation('client.command.completed', {}, 'request'),
      end,
      end,
    ]),
  });
  expect(lane.groups[0].requests[0].state).toBe('available');
});

test('voice events in the destination request buffer also disprove its session ownership', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    ]),
    requestEvents: panelEvents([
      observation('client.response.applied', {}, 'request'),
      {
        ...observation('voice.tool.result', {}, 'request'),
        sessionId: 'other-session',
      },
    ]),
  });
  expect(lane.groups[0].requests[0]).toMatchObject({
    state: 'unavailable',
    reason: 'ambiguous',
  });
});

test('a redacted result session cannot erase its invocation group context when linking requests', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.called', { invocationId: 'one' }),
      {
        ...observation('voice.tool.result', { invocationId: 'one' }, 'request'),
        sessionId: '[REDACTED]',
      },
    ]),
    requestEvents: panelEvents([
      {
        ...observation('client.response.applied', {}, 'request'),
        sessionId: 'other-session',
      },
    ]),
  });
  expect(lane.groups[0].requests[0]).toMatchObject({
    state: 'unavailable',
    reason: 'ambiguous',
  });
});

test.each([
  ['session', true],
  ['other-session', false],
] as const)('retained source-lane context checks a redacted result against request session %s', (targetSession, available) => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.media'),
      {
        ...observation('voice.tool.result', { invocationId: 'one' }, 'request'),
        sessionId: '[REDACTED]',
      },
    ]),
    requestEvents: panelEvents([
      {
        ...observation('client.response.applied', {}, 'request'),
        sessionId: targetSession,
      },
    ]),
  });
  expect(lane.groups[1].requests[0].state).toBe(
    available ? 'available' : 'unavailable',
  );
  if (!available)
    expect(lane.groups[1].requests[0]).toMatchObject({ reason: 'ambiguous' });
});

test('response correlation uses neutral lifecycle facts instead of provider event names', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'one',
        responsePhase: 'started',
        eventType: 'native.accepted',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'one',
        responsePhase: 'finished',
        responseOutcome: 'succeeded',
        eventType: 'native.settled',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'two',
        responsePhase: 'started',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'two',
        responsePhase: 'started',
      }),
    ]),
  });
  expect(lane.groups.map((group) => [group.type, group.events.length])).toEqual(
    [
      ['response', 2],
      ['unlinked', 1],
      ['unlinked', 1],
    ],
  );
});

test('legacy native-only response labels do not establish a normalized response lifecycle', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'one',
        eventType: 'response.created',
      }),
      observation('voice.provider.wire', {
        providerGeneration: 1,
        responseId: 'one',
        eventType: 'response.done',
        status: 'completed',
      }),
    ]),
  });
  expect(lane.groups.map((group) => group.type)).toEqual([
    'unlinked',
    'unlinked',
  ]);
});

test.each([
  'ambiguous',
  'exhausted',
] as const)('a %s history still permits independently proven direct links but cannot use Voice as destination proof', (state) => {
  const result = observation(
    'voice.tool.result',
    { invocationId: 'one' },
    'request',
  );
  const destination = observation('client.response.applied', {}, 'request');
  for (const [sessionId, expected] of [
    ['session', 'available'],
    ['[REDACTED]', 'unavailable'],
  ] as const) {
    const [lane] = voiceTimeline(
      {
        events: panelEvents([result]),
        requestEvents: panelEvents([{ ...destination, sessionId }, result]),
      },
      () => ({ state }),
    );
    expect(lane.groupingDisabled).toBe(true);
    expect(lane.groups[0].requests[0].state).toBe(expected);
    if (expected === 'unavailable')
      expect(lane.groups[0].requests[0]).toMatchObject({
        reason: 'unconfirmed',
      });
  }
});

test.each([
  { state: 'unobserved' },
  { state: 'observed' },
  { state: 'ambiguous' },
  { state: 'exhausted' },
] as const)('missing source proof stays unconfirmed with $state history', (context) => {
  const [lane] = voiceTimeline(
    {
      events: panelEvents([
        {
          ...observation(
            'voice.tool.result',
            { invocationId: 'one' },
            'request',
          ),
          sessionId: '[REDACTED]',
        },
      ]),
      requestEvents: panelEvents([
        observation('client.response.applied', {}, 'request'),
      ]),
    },
    () => context,
  );
  expect(lane.groups[0].requests[0]).toMatchObject({
    state: 'unavailable',
    reason: 'unconfirmed',
  });
});

test.each([
  'ambiguous',
  'exhausted',
] as const)('direct request ownership does not change when unrelated %s lane context expires', (state) => {
  const unrelated = observation('voice.media');
  const result = {
    ...observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    sessionId: 'direct-session',
  };
  const destination = {
    ...observation('client.response.applied', {}, 'request'),
    sessionId: 'direct-session',
  };
  for (const events of [[unrelated, result], [result]]) {
    const [lane] = voiceTimeline(
      {
        events: panelEvents(events),
        requestEvents: panelEvents([destination, result]),
      },
      () => ({ state }),
    );
    expect(lane.groupingDisabled).toBe(true);
    expect(lane.groups.at(-1)?.requests[0].state).toBe('available');
  }
});

test.each([
  'ambiguous',
  'exhausted',
] as const)('unreadable direct ownership stays unconfirmed when unrelated %s context expires', (state) => {
  const unrelated = observation('voice.media');
  const destination = {
    ...observation('client.response.applied', {}, 'request'),
    sessionId: 'destination-session',
  };
  for (const sessionId of ['[REDACTED]', undefined]) {
    const result = {
      ...observation('voice.tool.result', { invocationId: 'one' }, 'request'),
      sessionId,
    };
    for (const events of [[unrelated, result], [result]]) {
      const [lane] = voiceTimeline(
        {
          events: panelEvents(events),
          requestEvents: panelEvents([destination, result]),
        },
        () => ({ state }),
      );
      expect(lane.groups.at(-1)?.requests[0]).toMatchObject({
        state: 'unavailable',
        reason: 'unconfirmed',
      });
    }
  }
});

test.each([
  'ambiguous',
  'exhausted',
] as const)('missing source proof cannot hide destination contradictions with %s history', (state) => {
  const result = {
    ...observation('voice.tool.result', { invocationId: 'one' }, 'request'),
    sessionId: '[REDACTED]',
  };
  for (const requestEvents of [
    [
      observation('client.response.applied', {}, 'request'),
      {
        ...observation('engine.stage.completed', {}, 'request'),
        sessionId: 'other-session',
      },
    ],
    [
      observation('client.request.started', {}, 'request'),
      observation('client.request.started', {}, 'request'),
    ],
  ]) {
    const [lane] = voiceTimeline(
      {
        events: panelEvents([result]),
        requestEvents: panelEvents(requestEvents),
      },
      () => ({ state }),
    );
    expect(lane.groups[0].requests[0]).toMatchObject({
      state: 'unavailable',
      reason: 'ambiguous',
    });
  }
});

test('voice identity availability distinguishes withheld, malformed, and absent evidence without correlating it', () => {
  const lanes = voiceTimeline({
    events: panelEvents([
      observation('voice.media', {
        providerInstanceId: '[REDACTED]',
        generation: '[REDACTED]',
      }),
      observation('voice.media', { generation: undefined }),
      observation('voice.media', { generation: '[REDACTED]' }),
      observation('voice.media', { generation: '[TRUNCATED]' }),
      observation('voice.media', { generation: -1 }),
    ]),
  });
  expect(
    lanes.map((lane) => [
      lane.providerAvailability,
      lane.generationAvailability,
    ]),
  ).toEqual([
    ['redacted', 'redacted'],
    ['reported', 'not-reported'],
    ['reported', 'redacted'],
    ['reported', 'truncated'],
    ['reported', 'unreadable'],
  ]);
  expect(
    lanes.every((lane) =>
      lane.groups.every((group) => group.type === 'unlinked'),
    ),
  ).toBe(true);
});

test.each([
  ['[REDACTED]', 'redacted'],
  ['prefix[TRUNC', 'truncated'],
  ['[MAX_DEPTH]', 'unreadable'],
  [42, 'unreadable'],
  [{ value: 'request' }, 'unreadable'],
] as const)('unusable request identity %j retains its evidence without creating a navigation target', (requestId, reason) => {
  const [lane] = voiceTimeline({
    events: panelEvents([{ ...observation('voice.tool.result'), requestId }]),
  });
  expect(lane.groups[0].requests).toEqual([
    { state: 'identity-unavailable', reason },
  ]);
  expect(lane.events[0].raw.requestId).toEqual(requestId);
});

test('a readable request ID cannot establish ownership without an app identity', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation('voice.tool.result', { clientId: '[REDACTED]' }, 'request'),
    ]),
    requestEvents: panelEvents([
      observation('client.response.applied', {}, 'request'),
    ]),
  });
  expect(lane.groups[0].requests).toEqual([
    { state: 'unavailable', requestId: 'request', reason: 'unconfirmed' },
  ]);
});

test('request provenance cannot hide a readable app and request identity with the same words', () => {
  const [lane] = voiceTimeline({
    events: panelEvents([
      observation(
        'voice.tool.called',
        { clientId: 'identity-unavailable', invocationId: 'one' },
        '[REDACTED]',
      ),
      observation(
        'voice.tool.result',
        { clientId: 'identity-unavailable', invocationId: 'one' },
        'redacted',
      ),
    ]),
    requestEvents: panelEvents([
      observation(
        'client.response.applied',
        { clientId: 'identity-unavailable' },
        'redacted',
      ),
    ]),
  });
  expect(lane.groups[0].requests).toEqual([
    { state: 'identity-unavailable', reason: 'redacted' },
    {
      state: 'available',
      key: JSON.stringify(['identity-unavailable', 'redacted']),
      requestId: 'redacted',
    },
  ]);
});
