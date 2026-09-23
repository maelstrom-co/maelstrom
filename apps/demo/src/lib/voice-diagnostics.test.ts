import { SessionId, ToolCallId } from '@maelstrom-co/protocol';
import { expect, it } from 'vitest';
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
  const sessionId = SessionId();
  const callId = ToolCallId('call-1');
  diagnostics.onEvent(
    {
      type: 'tool_call',
      at: 1,
      sessionId,
      callId,
      name: 'update_ui',
      argumentsJson: '{}',
    },
    { provider: 'live', providerInstanceId: 'adapter-1', generation: 1 },
  );
  diagnostics.onEvent(
    { type: 'tool_result', at: 2, sessionId, callId, ok: true, latencyMs: 100 },
    { provider: 'live', providerInstanceId: 'adapter-1', generation: 2 },
  );
  expect(diagnostics.getSnapshot()[1]?.generation).toBe(1);
  for (let index = 0; index < 100; index++)
    diagnostics.record({ at: index + 3, kind: 'engine_started' });
  diagnostics.onEvent(
    {
      type: 'tool_result',
      at: 103,
      sessionId,
      callId,
      ok: true,
      latencyMs: 200,
    },
    { provider: 'live', providerInstanceId: 'adapter-1', generation: 2 },
  );
  expect(diagnostics.getSnapshot().at(-1)?.generation).toBeUndefined();
});

it('projects metadata before retention and excludes transcript, tool payloads, and native final configuration', () => {
  const diagnostics = new VoiceDiagnostics();
  const sessionId = SessionId();
  const callId = ToolCallId('fixture-call');
  diagnostics.onEvent({
    type: 'transcript',
    at: 1,
    sessionId,
    role: 'user',
    text: 'private-transcript',
    final: false,
  });
  diagnostics.onEvent({
    type: 'tool_call',
    at: 2,
    sessionId,
    callId,
    name: 'update_ui',
    argumentsJson: '{"intent":"private-intent"}',
  });
  diagnostics.onEvent({
    type: 'tool_result',
    at: 3,
    sessionId,
    callId,
    ok: true,
    latencyMs: 25,
  });
  expect(diagnostics.getSnapshot()).toEqual([
    { kind: 'tool_call', at: 2, id: callId, tool: 'update_ui' },
    { kind: 'tool_result', at: 3, id: callId, ok: true, durationMs: 25 },
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
