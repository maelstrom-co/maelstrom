import { expect, test } from 'bun:test';
import { MessageId, SessionId } from '@maelstrom-co/protocol';
import type { SetLayoutCommand } from './command-processor/command.types.js';
import { DiagnosticChannel } from './diagnostic-channel.js';

function builtInMetadataTypes(channel: DiagnosticChannel) {
  // @ts-expect-error A built-in terminal observation needs outcome evidence.
  channel.emit('client.action.completed');
  channel.emit('client.response.received', {
    source: 'request',
    // @ts-expect-error Built-in request timing must use a number.
    durationMs: '12',
  });
  // @ts-expect-error Built-in request completion must identify request or push evidence.
  channel.emit('client.response.received', { source: 'remote' });
  channel.emit('client.action.completed', {
    outcome: 'succeeded',
    // @ts-expect-error A successful Action cannot carry an error category.
    errorCategory: 'timeout',
  });
  channel.emit('application.custom', { custom: 'metadata' });
}
void builtInMetadataTypes;

test('refreshing a metadata subscription preserves one delivery per event and respects removal', () => {
  const channel = new DiagnosticChannel(SessionId('metadata-refresh'));
  const received: string[] = [];
  let release = () => {};
  let removePending = () => {};
  const observer = (kind: string) => {
    received.push(kind);
    removePending();
    if (received.length < 3) {
      release();
      release = channel.subscribeMetadata(observer);
    }
  };
  release = channel.subscribeMetadata(observer);
  removePending = channel.subscribeMetadata(() => {
    received.push('removed observer');
  });
  try {
    channel.emit('client.request.started');
    expect(received).toEqual(['client.request.started']);
    channel.emit('client.request.failed', { outcome: 'failed' });
    expect(received).toEqual([
      'client.request.started',
      'client.request.failed',
    ]);
    release();
    channel.emit('client.request.started');
    expect(received).toHaveLength(2);
  } finally {
    channel.dispose();
  }
});

test('adding operational observation preserves the full-diagnostic meaning of legacy sources and observed', () => {
  const channel = new DiagnosticChannel(SessionId('legacy-capability'));
  let diagnostics = 0;
  channel.addSource(() => {
    diagnostics++;
    return () => {
      diagnostics--;
    };
  });
  const releaseMetadata = channel.subscribeMetadata(() => {});
  expect(diagnostics).toBe(0);
  expect(channel.observed).toBe(false);
  const releaseDiagnostics = channel.subscribe(() => {});
  expect(diagnostics).toBe(1);
  expect(channel.observed).toBe(true);
  releaseDiagnostics();
  expect(diagnostics).toBe(0);
  releaseMetadata();
  channel.dispose();
});

test('operational observers activate local producers without granting diagnostic capabilities', () => {
  const channel = new DiagnosticChannel(SessionId('metadata-only'));
  let localStarts = 0;
  let localStops = 0;
  let diagnosticStarts = 0;
  let diagnosticStops = 0;
  channel.addLocalSource(() => {
    localStarts++;
    return () => {
      localStops++;
    };
  });
  channel.addDiagnosticSource(() => {
    diagnosticStarts++;
    return () => {
      diagnosticStops++;
    };
  });
  const metadata: unknown[][] = [];
  const releaseMetadata = channel.subscribeMetadata((...args) => {
    metadata.push(args);
  });
  expect(channel.observed).toBe(false);
  expect(channel.locallyObserved).toBe(true);
  expect(channel.diagnosticsObserved).toBe(false);
  expect([localStarts, diagnosticStarts]).toEqual([1, 0]);
  let contentReads = 0;
  channel.emit(
    'client.request.started',
    { durationMs: 4 },
    () => {
      contentReads++;
      return 'CANARY_intent';
    },
    'CANARY_request',
  );
  expect(metadata).toEqual([['client.request.started', { durationMs: 4 }]]);
  expect(contentReads).toBe(0);
  const releaseDiagnostics = channel.subscribe(() => {});
  expect([localStarts, diagnosticStarts]).toEqual([1, 1]);
  releaseDiagnostics();
  expect(channel.diagnosticsObserved).toBe(false);
  expect([localStops, diagnosticStops]).toEqual([0, 1]);
  releaseMetadata();
  expect([localStops, diagnosticStops]).toEqual([1, 1]);
  expect(channel.observed).toBe(false);
});

test('metadata-only publication creates no diagnostic envelope or content capability', () => {
  const channel = new DiagnosticChannel(SessionId('metadata-only'));
  const observations: unknown[][] = [];
  channel.subscribeMetadata((...args) => {
    observations.push(args);
  });
  const original = crypto.randomUUID;
  crypto.randomUUID = () => {
    throw new Error('Unexpected diagnostic envelope');
  };
  try {
    expect(() =>
      channel.emit('client.action.completed', { outcome: 'skipped' }, () => {
        throw new Error('CANARY_content');
      }),
    ).not.toThrow();
  } finally {
    crypto.randomUUID = original;
  }
  expect(observations).toEqual([
    ['client.action.completed', { outcome: 'skipped' }],
  ]);
  channel.dispose();
});

test('authoritative identities stay distinct while forwarded identifiers remain projected', () => {
  const sessionId = SessionId('application-session');
  const messageId = MessageId('application-request');
  // @ts-expect-error A message identity cannot construct an application session channel.
  const wrongSession: ConstructorParameters<typeof DiagnosticChannel>[0] =
    messageId;
  // @ts-expect-error Commands correlate messages rather than application sessions.
  const wrongRequest: SetLayoutCommand['requestId'] = sessionId;
  void [wrongSession, wrongRequest];
  const channel = new DiagnosticChannel(sessionId);
  const observations: { sessionId: string; requestId?: string }[] = [];
  channel.subscribe(({ event }) => observations.push(event));
  channel.emit('client.request.started', {}, undefined, messageId);
  channel.emitDiagnostic('engine.stage.completed', {}, undefined, '[REDACTED]');
  expect(observations).toMatchObject([
    { sessionId: 'application-session', requestId: 'application-request' },
    { sessionId: 'application-session', requestId: '[REDACTED]' },
  ]);
});

test.each([
  'observation',
  'control',
  'replay',
  'thenable',
] as const)('rejected diagnostic observers cannot terminate work or delay healthy delivery: %s', (mode) => {
  const probe = `
      import { DiagnosticChannel } from './diagnostic-channel.ts';
      import { SessionId } from '@maelstrom-co/protocol';
      const channel = new DiagnosticChannel(SessionId('fixture'));
      const mode = ${JSON.stringify(mode)};
      const reject = async () => { throw new Error('optional observer rejected'); };
      if (mode === 'observation') channel.subscribe(reject);
      else if (mode === 'thenable') channel.subscribe(() => ({
        then(resolve, reject) { reject(new Error('optional thenable rejected')); }
      }));
      else {
        if (mode === 'replay') channel.emit('devtools.fixture', { enabled: false });
        channel.observeControls(reject);
      }
      const delivered = [];
      channel.subscribe(() => delivered.push('first'));
      channel.subscribe(() => delivered.push('second'));
      channel.emit('devtools.fixture', { enabled: true });
      if (delivered.join(',') !== 'first,second') throw new Error('Delivery was delayed');
      await new Promise(resolve => setTimeout(resolve, 10));
      channel.dispose();
      console.log(JSON.stringify(delivered));
    `;
  const child = Bun.spawnSync(
    [process.execPath, '--no-env-file', '--eval', probe],
    {
      cwd: import.meta.dir,
    },
  );
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  expect(JSON.parse(child.stdout.toString())).toEqual(['first', 'second']);
});

test('a failing optional source cannot prevent other sources from releasing', () => {
  const channel = new DiagnosticChannel(SessionId('fixture'));
  let released = false;
  channel.addSource(() => () => {
    throw new Error('optional cleanup failed');
  });
  channel.addSource(() => () => {
    released = true;
  });
  const detach = channel.subscribe(() => {});
  expect(() => detach()).not.toThrow();
  expect(released).toBe(true);
  expect(channel.observed).toBe(false);
});

test.each([
  'unsubscribe',
  'dispose',
  'reattach',
] as const)('source startup releases only the observation lifetime that ended: %s', (mode) => {
  const channel = new DiagnosticChannel(SessionId('fixture'));
  const released: number[] = [];
  let starts = 0;
  let first = true;
  let detach = () => {};
  let detachReplacement = () => {};
  detach = channel.subscribe(() => {
    if (!first) return;
    first = false;
    if (mode === 'dispose') channel.dispose();
    else {
      detach();
      if (mode === 'reattach') detachReplacement = channel.subscribe(() => {});
    }
  });
  channel.addSource(() => {
    const lifetime = ++starts;
    channel.emit('source.initial');
    return () => {
      released.push(lifetime);
    };
  });
  expect(released).toEqual([1]);
  if (mode === 'reattach') {
    expect(channel.observed).toBe(true);
    expect(starts).toBe(2);
    detachReplacement();
    expect(released).toEqual([1, 2]);
  } else expect(channel.observed).toBe(false);
  channel.dispose();
  expect(released).toEqual(mode === 'reattach' ? [1, 2] : [1]);
});

test('a source removed during startup cannot remain observed or restart', () => {
  const channel = new DiagnosticChannel(SessionId('fixture'));
  let starts = 0;
  let released = 0;
  const removeSource = channel.addSource(() => {
    starts++;
    if (starts === 1) removeSource();
    return () => {
      released++;
    };
  });
  const detach = channel.subscribe(() => {});
  expect(released).toBe(1);
  detach();
  channel.subscribe(() => {});
  expect(starts).toBe(1);
  channel.dispose();
  expect(released).toBe(1);
});

test('reattaching during cleanup restarts every source in the new observation lifetime', () => {
  const channel = new DiagnosticChannel(SessionId('fixture'));
  const starts = [0, 0];
  const stops = [0, 0];
  let detachReplacement = () => {};
  channel.addSource(() => {
    starts[0]++;
    return () => {
      stops[0]++;
      if (stops[0] === 1) detachReplacement = channel.subscribe(() => {});
    };
  });
  channel.addSource(() => {
    starts[1]++;
    return () => {
      stops[1]++;
    };
  });
  const detach = channel.subscribe(() => {});
  detach();
  expect(channel.observed).toBe(true);
  expect(starts).toEqual([2, 2]);
  expect(stops).toEqual([1, 1]);
  detachReplacement();
  expect(channel.observed).toBe(false);
  expect(stops).toEqual([2, 2]);
  channel.dispose();
  expect(stops).toEqual([2, 2]);
});

test('late Chart observers receive the current control state without enabling collection', () => {
  const channel = new DiagnosticChannel(SessionId('fixture'));
  channel.emit('devtools.overlays.changed', { enabled: true });
  const enabled: unknown[] = [];
  const detach = channel.observeControls((event) =>
    enabled.push(event.metadata.enabled),
  );
  expect(channel.observed).toBe(false);
  expect(enabled).toEqual([true]);
  channel.emit('devtools.overlays.changed', { enabled: false });
  expect(enabled).toEqual([true, false]);
  detach();
  const remounted: unknown[] = [];
  channel.observeControls((event) => remounted.push(event.metadata.enabled));
  expect(remounted).toEqual([false]);
  channel.dispose();
  const disposed: unknown[] = [];
  channel.observeControls((event) => disposed.push(event));
  channel.emit('devtools.overlays.changed', { enabled: true });
  expect(disposed).toEqual([]);
});
