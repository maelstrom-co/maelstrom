import { describe, expect, it } from 'bun:test';
import type { TimedTranscriptFragment } from '@maelstrom-co/client';
import { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import {
  RealtimeSessionMemory,
  recoveryMemorySubscriber,
} from './realtime-session-memory.js';

describe('recoveryMemorySubscriber', () => {
  it('records valid fragments with the connection they were observed on', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);

    handle(fragmentEvent({ ...userFragment, id: 'kept' }, 'connection-1'));
    handle(fragmentEvent({ ...userFragment, id: '' }, 'connection-1'));
    handle(fragmentEvent({ ...userFragment, endMs: -1 }, 'connection-1'));

    expect(memory.getSnapshot().fragments).toEqual([
      {
        connectionId: 'connection-1',
        id: 'kept',
        role: 'user',
        startMs: 0,
        endMs: 100,
        text: 'hello',
        truncated: false,
      },
    ]);
  });

  it('applies the owning session text limit to fragments', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory, 4);

    handle(fragmentEvent({ ...userFragment, text: 'hello' }, 'connection-1'));

    expect(memory.getSnapshot().fragments).toEqual([]);
  });

  it('inserts a first submission and updates it with later outcomes', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);
    const callId = ToolCallId('call-1');

    handle({
      type: 'tool.submitted',
      callId,
      intent: 'show labs',
      retry: false,
    });
    handle({ type: 'tool.queued', callId, intent: 'show labs' });
    handle({
      type: 'tool.submitted',
      callId,
      intent: 'show labs',
      retry: true,
    });
    handle({
      type: 'tool.unconfirmed',
      callId,
      intent: 'show labs',
      summary: 'Could not confirm.',
    });

    expect(memory.getSnapshot().outcomes).toEqual([
      {
        id: callId,
        intent: 'show labs',
        status: 'unknown',
        summary: 'Could not confirm.',
      },
    ]);
  });

  it('maps every later outcome event to its recovery status', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);
    const statuses = (
      [
        'tool.queued',
        'tool.completed',
        'tool.failed',
        'tool.unconfirmed',
        'tool.not_submitted',
      ] as const
    ).map((type) => {
      const callId = ToolCallId(type);
      handle({
        type: 'tool.submitted',
        callId,
        intent: 'show labs',
        retry: false,
      });
      handle({ type, callId, intent: 'show labs' });
      return memory.find(callId)?.status;
    });

    expect(statuses).toEqual([
      'queued',
      'completed',
      'failed',
      'unknown',
      'not_submitted',
    ]);
  });

  it('drops later outcomes and retried submissions for a request evicted from the window', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);
    const evicted = ToolCallId('evicted');
    handle({
      type: 'tool.submitted',
      callId: evicted,
      intent: 'old',
      retry: false,
    });
    for (let index = 0; index < 8; index++)
      handle({
        type: 'tool.submitted',
        callId: ToolCallId(`newer-${index}`),
        intent: `newer ${index}`,
        retry: false,
      });
    const before = memory.getSnapshot();

    for (const type of [
      'tool.completed',
      'tool.failed',
      'tool.unconfirmed',
    ] as const)
      handle({ type, callId: evicted, intent: 'old' });
    handle({
      type: 'tool.submitted',
      callId: evicted,
      intent: 'old',
      retry: true,
    });

    expect(memory.getSnapshot()).toEqual(before);
    expect(memory.find(evicted)).toBeUndefined();
  });

  it('never records an outcome for a request that was not submitted first', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);

    for (const type of [
      'tool.completed',
      'tool.failed',
      'tool.unconfirmed',
    ] as const)
      handle({
        type,
        callId: ToolCallId(type),
        intent: 'show labs',
      });

    expect(memory.getSnapshot().outcomes).toEqual([]);
  });

  it('records queued and refused admission without inventing a submission', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);
    handle({
      type: 'tool.queued',
      callId: ToolCallId('queued'),
      intent: 'one',
    });
    handle({
      type: 'tool.not_submitted',
      callId: ToolCallId('full'),
      intent: 'two',
    });
    expect(memory.getSnapshot().outcomes.map((value) => value.status)).toEqual([
      'queued',
      'not_submitted',
    ]);
  });

  for (const admission of ['tool.queued', 'tool.submitted'] as const) {
    it(`never rewrites terminal uncertainty after ${admission} with late success or submission`, () => {
      const memory = new RealtimeSessionMemory(sessionId);
      const handle = recoveryMemorySubscriber(memory);
      const callId = ToolCallId('late');
      handle({ type: admission, callId, intent: 'one', retry: false });
      handle({ type: 'tool.unconfirmed', callId, intent: 'one' });
      const before = memory.getSnapshot();
      handle({ type: 'tool.completed', callId, intent: 'one' });
      handle({ type: 'tool.submitted', callId, intent: 'one', retry: false });
      expect(memory.find(callId)?.status).toBe('unknown');
      expect(memory.getSnapshot()).toEqual(before);
    });
  }

  it('does not resurrect an evicted queued request at its first dispatch', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);
    const callId = ToolCallId('evicted-queued');
    handle({ type: 'tool.queued', callId, intent: 'old' });
    for (let index = 0; index < 8; index++)
      handle({
        type: 'tool.queued',
        callId: ToolCallId(`new-${index}`),
        intent: 'new',
      });
    handle({ type: 'tool.submitted', callId, intent: 'old', retry: false });
    handle({ type: 'tool.not_submitted', callId, intent: 'old' });
    expect(memory.find(callId)).toBeUndefined();
  });

  it('leaves memory untouched for lifecycle, media and the opening claim', () => {
    const memory = new RealtimeSessionMemory(sessionId);
    const handle = recoveryMemorySubscriber(memory);
    let notifications = 0;
    memory.subscribe(() => {
      notifications += 1;
    });

    handle({ type: 'session.started', generation: 1, connectionId: 'c1' });
    handle({ type: 'session.connected', generation: 1 });
    handle({ type: 'media', generation: 1, media: { microphone: 'active' } });
    handle({ type: 'opening.claimed' });
    handle({ type: 'session.disconnected', generation: 1 });

    expect(notifications).toBe(0);
    expect(memory.getSnapshot()).toEqual({
      introductionAttempted: false,
      fragments: [],
      outcomes: [],
    });
  });
});

const sessionId = SessionId('memory-test-session');

const userFragment: TimedTranscriptFragment = {
  id: 'fragment-1',
  role: 'user',
  speakerId: 'user',
  text: 'hello',
  startMs: 0,
  endMs: 100,
};

function fragmentEvent(
  fragment: TimedTranscriptFragment,
  connectionId: string,
) {
  return {
    type: 'transcript.fragment' as const,
    generation: 1,
    connectionId,
    fragment,
  };
}
