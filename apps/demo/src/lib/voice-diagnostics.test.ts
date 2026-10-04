import { ToolCallId } from '@maelstrom-co/protocol';
import { expect, it, vi } from 'vitest';
import { projectLiveTransport, VoiceDiagnostics } from './voice-diagnostics';

it('does not retain unbounded or content-shaped provider session identifiers', () => {
  const diagnostics = new VoiceDiagnostics();
  for (const sessionId of [
    'x'.repeat(129),
    'Bearer private-value',
    '<private-content>',
    'line\nbreak',
  ]) {
    expect(
      projectLiveTransport({
        generation: 1,
        sessionId,
        state: 'closed',
        finalization: 'confirmed',
        playback: 'accepted',
      }).sessionId,
    ).toBeUndefined();
    diagnostics.retainTransport(
      {
        generation: 1,
        sessionId,
        state: 'closed',
        finalization: 'confirmed',
        playback: 'accepted',
        closedEvent: {
          type: 'session.closed',
          event_id: 'safe',
          session: { instructions: 'private-content', apiKey: 'private-key' },
        },
      },
      {
        providerInstanceId: 'local-instance',
        model: 'gpt-live-1',
        backendModel: 'gpt-6-luna',
      },
    );
    expect(JSON.stringify(diagnostics.getTransportHistory())).not.toMatch(
      /private-|Bearer|closedEvent|apiKey|instructions/,
    );
  }
  expect(
    projectLiveTransport({
      generation: 1,
      sessionId: 'live_safe-123',
      state: 'closed',
      finalization: 'confirmed',
      playback: 'accepted',
    }).sessionId,
  ).toBe('live_safe-123');
});

it('keeps late tool outcomes on their measured generation rather than the replacement generation', () => {
  const diagnostics = new VoiceDiagnostics();
  const callId = ToolCallId('call-1');
  diagnostics.onSessionEvent(
    { type: 'tool.called', callId, name: 'update_ui', argumentsJson: '{}' },
    { provider: 'live', providerInstanceId: 'adapter-1', generation: 1 },
  );
  diagnostics.onSessionEvent(
    { type: 'tool.result', callId, ok: true, latencyMs: 100 },
    { provider: 'live', providerInstanceId: 'adapter-1', generation: 2 },
  );
  expect(diagnostics.getSnapshot()[1]?.generation).toBe(1);
  for (let index = 0; index < 100; index++)
    diagnostics.record({ at: index + 3, kind: 'engine_started' });
  diagnostics.onSessionEvent(
    { type: 'tool.result', callId, ok: true, latencyMs: 200 },
    { provider: 'live', providerInstanceId: 'adapter-1', generation: 2 },
  );
  expect(diagnostics.getSnapshot().at(-1)?.generation).toBeUndefined();
});

it('projects metadata before retention and excludes transcript, tool payloads, and native final configuration', () => {
  const diagnostics = new VoiceDiagnostics();
  const callId = ToolCallId('fixture-call');
  const clock = vi.spyOn(Date, 'now');
  clock.mockReturnValue(1);
  diagnostics.onSessionEvent({
    type: 'transcript.entry',
    role: 'user',
    text: 'private-transcript',
    final: false,
  });
  diagnostics.onSessionEvent({
    type: 'transcript.fragment',
    generation: 1,
    connectionId: 'fixture-connection',
    fragment: {
      id: 'fixture-fragment',
      role: 'user',
      speakerId: 'user',
      text: 'private-fragment',
      startMs: 0,
      endMs: 100,
    },
  });
  clock.mockReturnValue(2);
  diagnostics.onSessionEvent({
    type: 'tool.called',
    callId,
    name: 'update_ui',
    argumentsJson: '{"intent":"private-intent"}',
  });
  diagnostics.onSessionEvent({
    type: 'tool.submitted',
    callId,
    intent: 'private-intent',
    retry: false,
  });
  clock.mockReturnValue(3);
  diagnostics.onSessionEvent({
    type: 'tool.result',
    callId,
    ok: true,
    latencyMs: 25,
  });
  clock.mockRestore();
  expect(diagnostics.getSnapshot()).toEqual([
    {
      entryId: expect.any(String),
      kind: 'tool_call',
      at: 2,
      id: callId,
      tool: 'update_ui',
    },
    {
      entryId: expect.any(String),
      kind: 'tool_result',
      at: 3,
      id: callId,
      ok: true,
      durationMs: 25,
    },
  ]);
  const transport = projectLiveTransport({
    generation: 1,
    state: 'closed',
    finalization: 'confirmed',
    playback: 'accepted',
    usageSeconds: 3,
    finalUsageSeconds: 3,
    closedEvent: {
      event_id: 'fixture-event',
      type: 'session.closed',
      session: { instructions: 'private-config' },
      usage: { seconds: 3 },
    },
  });
  expect(
    JSON.stringify({ transport, entries: diagnostics.getSnapshot() }),
  ).not.toMatch(/private-|argumentsJson|closedEvent/);
});

it('bounds the timeline while retaining matching tool IDs and measured durations', () => {
  const diagnostics = new VoiceDiagnostics();
  for (let index = 0; index < 150; index++)
    diagnostics.record({
      at: index,
      kind: 'engine_started',
      id: `request-${index}`,
    });
  expect(diagnostics.getSnapshot()).toHaveLength(100);
  expect(diagnostics.getSnapshot()[0]?.id).toBe('request-50');
});

it('records each connection lifecycle fact with its own generation', () => {
  const diagnostics = new VoiceDiagnostics();
  const identity = {
    provider: 'live',
    providerInstanceId: 'adapter-1',
  } as const;
  diagnostics.onSessionEvent(
    { type: 'session.started', generation: 1, connectionId: 'c1' },
    identity,
  );
  diagnostics.onSessionEvent(
    { type: 'session.connected', generation: 1 },
    identity,
  );
  diagnostics.onSessionEvent(
    { type: 'session.error', generation: 1 },
    identity,
  );
  diagnostics.onSessionEvent(
    { type: 'session.started', generation: 2, connectionId: 'c2' },
    identity,
  );
  diagnostics.onSessionEvent(
    { type: 'session.disconnecting', generation: 2 },
    identity,
  );
  diagnostics.onSessionEvent(
    { type: 'session.disconnected', generation: 2 },
    identity,
  );
  diagnostics.onSessionEvent(
    { type: 'media', generation: 2, media: { microphone: 'active' } },
    identity,
  );
  diagnostics.onSessionEvent({ type: 'opening.claimed' }, identity);

  expect(
    diagnostics
      .getSnapshot()
      .map((entry) => [entry.kind, entry.state, entry.generation]),
  ).toEqual([
    ['voice_state', 'connecting', 1],
    ['voice_state', 'connected', 1],
    ['voice_state', 'error', 1],
    ['voice_state', 'connecting', 2],
    ['voice_state', 'disconnecting', 2],
    ['voice_state', 'disconnected', 2],
  ]);
  expect(diagnostics.getSnapshot()[0]).toMatchObject(identity);
});
