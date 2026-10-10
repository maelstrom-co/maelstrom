import type { VoiceObservationSnapshot } from '@maelstrom-co/client';
import { ToolCallId } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { DiagnosticCapture } from './diagnostic-capture';
import { selectVoiceProvider, voiceProviderStore } from './voice-provider';

describe('local diagnostic capture', () => {
  it.each([
    'live',
    'realtime',
    'livekit',
  ] as const)('preserves the selected %s voice provider in generic devtools captures', (provider) => {
    const previous = voiceProviderStore.state.provider;
    try {
      selectVoiceProvider(provider);
      const capture = new DiagnosticCapture();
      capture.start('maelstrom', 'session', 'provider');
      expect(JSON.parse(capture.export()).metadata.mode).toBe(provider);
    } finally {
      selectVoiceProvider(previous);
    }
  });
  it('does not present the Realtime default as the model used by a server-owned session', () => {
    const capture = new DiagnosticCapture();
    capture.start('realtime', 'session', 'provider');
    expect(JSON.parse(capture.export()).metadata).toMatchObject({
      voiceModel: null,
      voiceModelSource: 'unobserved',
      defaultVoiceModel: 'gpt-realtime-2.1',
    });
  });

  it('retains capture identity and notes until an explicit reset, even when key custody changes', () => {
    let key: string | null = 'private-test-key';
    const capture = new DiagnosticCapture(() => key);
    capture.start('live', 'session', 'provider');
    capture.setOutcome(
      'Expected journal; accidentally pasted private-test-key',
    );
    key = null;
    capture.stop();
    expect(capture.getSnapshot()).toMatchObject({
      mode: 'live',
      outcome: 'Expected journal; accidentally pasted [REDACTED]',
    });
    expect(JSON.parse(capture.export()).outcome).toBe(
      capture.getSnapshot().outcome,
    );
    capture.clear();
    expect(capture.getSnapshot()).toMatchObject({ outcome: '' });
    expect(capture.getSnapshot().mode).toBeUndefined();
  });

  it('keeps distinct nanoid correlations while redacting known and full-length credentials', () => {
    const capture = new DiagnosticCapture(() => 'short-known-key');
    capture.start('typed', 'session', 'provider');
    for (const id of ['sk-123456789012345678', 'sk-987654321098765432'])
      capture.record('tool_call', { callId: id });
    const trace = capture.export(`short-known-key sk-${'a'.repeat(40)}`);
    expect(trace).toContain('sk-123456789012345678');
    expect(trace).toContain('sk-987654321098765432');
    expect(trace).not.toContain('short-known-key');
    expect(trace).not.toContain(`sk-${'a'.repeat(40)}`);
  });
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
      type: 'tool.called' as const,
      callId: ToolCallId('call'),
      name: 'update_ui',
      argumentsJson: JSON.stringify({
        intent: 'Create a journal titled today’s date',
      }),
    };
    capture.sessionEvent(event, { provider: 'live' });
    expect(capture.export('')).not.toContain('Create a journal');
    capture.start('live', 'session', 'provider');
    capture.sessionEvent(event, { provider: 'live' });
    expect(JSON.parse(capture.export('')).events).toContainEqual(
      expect.objectContaining({
        kind: 'tool_call',
        intent: 'Create a journal titled today’s date',
        callId: 'call',
      }),
    );
    capture.stop();
    const count = capture.getSnapshot().count;
    capture.sessionEvent(event, {});
    expect(capture.getSnapshot().count).toBe(count);
    capture.start('typed', 'other-session', 'other-provider');
    expect(capture.export('')).not.toContain('Create a journal');
    capture.clear();
    expect(capture.getSnapshot()).toEqual({
      active: false,
      count: 0,
      dropped: 0,
      outcome: '',
    });
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
