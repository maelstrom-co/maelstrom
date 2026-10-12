import { expect, test } from 'bun:test';
import { MessageId, SessionId } from '@maelstrom-co/protocol';
import type { SetLayoutCommand } from './command-processor/command.types.js';
import { DiagnosticChannel } from './diagnostic-channel.js';

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
  channel.emit('engine.stage.completed', {}, undefined, '[REDACTED]');
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
