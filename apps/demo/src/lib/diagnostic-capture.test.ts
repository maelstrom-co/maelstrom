import type { VoiceObservationSnapshot } from '@maelstrom-co/client';
import { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { DiagnosticCapture } from './diagnostic-capture';

describe('local diagnostic capture', () => {
  it('does not replay pre-capture captions but retains revisions observed during the trial', () => {
    const capture = new DiagnosticCapture();
    const snapshot: VoiceObservationSnapshot = {
      generation: 1,
      connection: 'connected',
      media: {
        microphone: 'active',
        userSpeech: 'inactive',
        incomingAudio: 'inactive',
      },
      applicationWork: { planning: 'inactive', applying: 'inactive' },
      captions: [],
      fragments: [
        {
          id: 'fragment',
          role: 'user',
          speakerId: 'user',
          text: 'before recording',
          startMs: 0,
          endMs: 100,
        },
      ],
    };
    capture.start('live', 'session', 'provider');
    capture.observations(snapshot, { providerInstanceId: 'provider' }, true);
    capture.observations(snapshot, { providerInstanceId: 'provider' });
    expect(capture.export('')).not.toContain('before recording');
    capture.observations(
      {
        ...snapshot,
        fragments: [
          { ...snapshot.fragments[0], text: 'revised during recording' },
        ],
      },
      { providerInstanceId: 'provider' },
    );
    expect(capture.export('')).toContain('revised during recording');
  });
  it('requires an explicit recording window and clears prior content for the next trial', () => {
    const capture = new DiagnosticCapture();
    const event = {
      type: 'tool_call' as const,
      at: 0,
      sessionId: SessionId('session'),
      callId: ToolCallId('call'),
      name: 'update_ui',
      argumentsJson: JSON.stringify({
        intent: 'Create a journal titled today’s date',
      }),
    };
    capture.sidechannel(event, { provider: 'live' });
    expect(capture.export('')).not.toContain('Create a journal');
    capture.start('live', 'session', 'provider');
    capture.liveWire(
      JSON.stringify({
        type: 'session.delegation.created',
        delegation: {
          id: 'delegation-1',
          response_id: 'response-1',
          instructions: 'private instructions',
        },
      }),
      'received',
      'peer',
    );
    capture.sidechannel(event, { provider: 'live' });
    expect(JSON.parse(capture.export('')).events).toContainEqual(
      expect.objectContaining({
        kind: 'tool_call',
        intent: 'Create a journal titled today’s date',
        callId: 'call',
      }),
    );
    capture.stop();
    const count = capture.getSnapshot().count;
    capture.sidechannel(event, {});
    expect(capture.getSnapshot().count).toBe(count);
    capture.start('typed', 'other-session', 'other-provider');
    expect(capture.export('')).not.toContain('Create a journal');
    capture.clear();
    expect(capture.getSnapshot()).toEqual({
      active: false,
      count: 0,
      dropped: 0,
    });
  });

  it('retains native function timing and intent without session credentials or arbitrary provider fields', () => {
    const capture = new DiagnosticCapture(() => 'private-test-key');
    capture.start('live', 'session', 'provider');
    capture.liveWire(
      JSON.stringify({
        type: 'session.started',
        apiKey: 'private-test-key',
        instructions: 'private instructions',
      }),
      'received',
      'peer',
    );
    capture.liveWire(
      JSON.stringify({
        type: 'response.event',
        delegation_id: 'delegation-1',
        event: {
          type: 'response.output_item.done',
          response_id: 'response-1',
          item: {
            type: 'function_call',
            call_id: 'native-call',
            name: 'update_ui',
            arguments: JSON.stringify({
              intent: 'Show journal private-test-key sk-testsecret',
              apiKey: 'private-test-key',
            }),
            otherContent: 'unrelated-secret',
          },
        },
      }),
      'received',
      'peer',
    );
    capture.liveWire('invalid', 'received', 'peer');
    const output = capture.export('Bearer secret-value');
    expect(output).not.toMatch(
      /private-test-key|sk-testsecret|unrelated-secret|private instructions|secret-value|apiKey/,
    );
    expect(JSON.parse(output).events).toContainEqual(
      expect.objectContaining({
        kind: 'live_wire',
        delegationId: 'delegation-1',
        responseId: 'response-1',
        callId: 'native-call',
        intent: 'Show journal [REDACTED] [REDACTED]',
      }),
    );
  });

  it('preserves repeated calls as evidence while bounding the trace and reporting omissions', () => {
    const capture = new DiagnosticCapture();
    capture.start('live', 'session', 'provider');
    for (let i = 0; i < 1100; i++) capture.record('call', { id: i });
    const trace = JSON.parse(capture.export(''));
    expect(trace.events).toHaveLength(1000);
    expect(trace.droppedEvents).toBe(101);
    expect(trace.events[1].id).toBe(0);
    expect(trace.events[999].id).toBe(998);
    expect(trace.events[999].elapsedMs).toBeGreaterThanOrEqual(
      trace.events[1].elapsedMs,
    );
  });
});
