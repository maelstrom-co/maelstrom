import { afterEach, describe, expect, it } from 'bun:test';
import { ToolCallId } from '@maelstrom-co/protocol';
import { type SessionEvent, SessionEventBus } from './session-event-bus.js';

describe('SessionEventBus', () => {
  afterEach(() => {
    expect(unexpectedReports.splice(0)).toEqual([]);
  });

  it('delivers every event to every subscriber in publish order', () => {
    const bus = reportingBus();
    const first: string[] = [];
    const second: string[] = [];
    bus.subscribe((event) => first.push(event.type));
    bus.subscribe((event) => second.push(event.type));

    bus.publish(started(1));
    bus.publish({ type: 'session.connected', generation: 1 });
    bus.publish({
      type: 'media',
      generation: 1,
      media: { microphone: 'active' },
    });

    const expected = ['session.started', 'session.connected', 'media'];
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
  });

  it('has every subscriber up to date when the publish call returns', () => {
    const bus = reportingBus();
    let seen: SessionEvent | undefined;
    bus.subscribe((event) => {
      seen = event;
    });
    const event = started(1);

    bus.publish(event);

    expect(seen).toBe(event);
  });

  it('queues a publish made during delivery behind the event being delivered', () => {
    const bus = reportingBus();
    const log: string[] = [];
    bus.subscribe((event) => {
      log.push(`first:${event.type}`);
      if (event.type === 'session.started')
        bus.publish({ type: 'session.disconnecting', generation: 1 });
    });
    bus.subscribe((event) => log.push(`second:${event.type}`));

    bus.publish(started(1));

    expect(log).toEqual([
      'first:session.started',
      'second:session.started',
      'first:session.disconnecting',
      'second:session.disconnecting',
    ]);
  });

  it('keeps one global order when several subscribers publish during one delivery', () => {
    const bus = reportingBus();
    const log: string[] = [];
    bus.subscribe((event) => {
      if (event.type === 'session.started')
        bus.publish({ type: 'session.connected', generation: 1 });
    });
    bus.subscribe((event) => {
      if (event.type === 'session.started')
        bus.publish({ type: 'session.error', generation: 1 });
    });
    bus.subscribe((event) => log.push(event.type));

    bus.publish(started(1));

    expect(log).toEqual([
      'session.started',
      'session.connected',
      'session.error',
    ]);
  });

  it('isolates a throwing subscriber and reports each failure with its event', () => {
    const reports: Array<{ error: unknown; event: SessionEvent }> = [];
    const bus = new SessionEventBus((error, event) =>
      reports.push({ error, event }),
    );
    const failure = new Error('subscriber failed');
    const received: string[] = [];
    bus.subscribe(() => {
      throw failure;
    });
    bus.subscribe((event) => received.push(event.type));
    const first = started(1);
    const second: SessionEvent = { type: 'session.connected', generation: 1 };

    bus.publish(first);
    bus.publish(second);

    expect(received).toEqual(['session.started', 'session.connected']);
    expect(reports).toEqual([
      { error: failure, event: first },
      { error: failure, event: second },
    ]);
  });

  it('keeps delivering when the error reporter itself throws', () => {
    const bus = new SessionEventBus(() => {
      throw new Error('reporter failed');
    });
    const received: string[] = [];
    bus.subscribe(() => {
      throw new Error('subscriber failed');
    });
    bus.subscribe((event) => received.push(event.type));

    bus.publish(started(1));
    bus.publish({ type: 'session.connected', generation: 1 });

    expect(received).toEqual(['session.started', 'session.connected']);
  });

  it('drains events queued behind a throwing subscriber', () => {
    const bus = new SessionEventBus(() => {});
    const received: string[] = [];
    bus.subscribe((event) => {
      if (event.type !== 'session.started') return;
      bus.publish({ type: 'session.connected', generation: 1 });
      throw new Error('subscriber failed');
    });
    bus.subscribe((event) => received.push(event.type));

    bus.publish(started(1));
    bus.publish({ type: 'session.disconnected', generation: 1 });

    expect(received).toEqual([
      'session.started',
      'session.connected',
      'session.disconnected',
    ]);
  });

  it('stops delivery after unsubscribe, including events already queued', () => {
    const bus = reportingBus();
    const received: string[] = [];
    let release = (): void => {};
    bus.subscribe((event) => {
      if (event.type !== 'session.started') return;
      bus.publish({ type: 'session.connected', generation: 1 });
      release();
    });
    release = bus.subscribe((event) => received.push(event.type));

    bus.publish(started(1));
    bus.publish({ type: 'session.disconnected', generation: 1 });

    expect(received).toEqual([]);
  });

  it('delivers to a released handler no more, and releasing twice is harmless', () => {
    const bus = reportingBus();
    const received: string[] = [];
    const release = bus.subscribe((event) => received.push(event.type));

    bus.publish(started(1));
    release();
    release();
    bus.publish(started(2));

    expect(received).toEqual(['session.started']);
  });

  it('counts the same handler subscribed twice as two independent subscriptions', () => {
    const bus = reportingBus();
    const received: string[] = [];
    const handler = (event: SessionEvent) => received.push(event.type);
    const releaseFirst = bus.subscribe(handler);
    bus.subscribe(handler);

    releaseFirst();
    bus.publish(started(1));

    expect(received).toEqual(['session.started']);
  });

  it('replays nothing to a late subscriber', () => {
    const bus = reportingBus();
    bus.publish(started(1));
    const received: string[] = [];
    bus.subscribe((event) => received.push(event.type));

    bus.publish({
      type: 'tool.completed',
      callId: ToolCallId('call-1'),
      intent: 'show labs',
    });

    expect(received).toEqual(['tool.completed']);
  });
});

function started(generation: number): SessionEvent {
  return {
    type: 'session.started',
    generation,
    connectionId: `connection-${generation}`,
  };
}

const unexpectedReports: unknown[] = [];

function reportingBus(): SessionEventBus {
  return new SessionEventBus((error) => unexpectedReports.push(error));
}
it.each([
  'async',
  'thenable',
  'getter',
  'reporter',
] as const)('optional rejected %s observers cannot terminate the process or delay healthy facts', (mode) => {
  const probe = `
    import { SessionEventBus } from './session-event-bus.ts';
    const mode = ${JSON.stringify(mode)};
    const bus = new SessionEventBus(mode === 'reporter' ? async () => { throw new Error('reporter rejected'); } : () => {});
    if (mode === 'async') bus.subscribe(async () => { throw new Error('observer rejected'); });
    else if (mode === 'thenable') bus.subscribe(() => ({ then(resolve, reject) { reject(new Error('thenable rejected')); } }));
    else if (mode === 'getter') bus.subscribe(() => ({ get then() { throw new Error('then getter failed'); } }));
    else bus.subscribe(() => { throw new Error('observer failed'); });
    let delivered = 0;
    bus.subscribe(() => { delivered++; });
    bus.publish({type:'session.connected', generation:1});
    if (delivered !== 1) throw new Error('Healthy delivery changed');
    await new Promise(resolve => setTimeout(resolve, 10));
    console.log('healthy');
  `;
  const child = Bun.spawnSync(
    [process.execPath, '--no-env-file', '--eval', probe],
    { cwd: import.meta.dir },
  );
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  expect(child.stdout.toString().trim()).toBe('healthy');
});
