import { WebSocketConnector } from '@maelstrom-co/client';
import {
  type ChartRequestMessage,
  type MaelstromResponse,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import { afterEach, expect, it, vi } from 'vitest';
import { diagnosticCapture } from './diagnostic-capture';
import { DiagnosticConnector } from './diagnostic-connector';

afterEach(() => {
  vi.restoreAllMocks();
  diagnosticCapture.clear();
});

it('captures one Engine exchange without resubmitting or rewriting it', async () => {
  const message = {
    id: MessageId('request'),
    sessionId: SessionId('session'),
    request: {
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'Show journal' }],
      },
    },
  } as unknown as ChartRequestMessage;
  const response = {
    userMessage: 'Done',
    executionPlan: [
      {
        instanceId: 'journal',
        action: 'setTitle',
        params: { title: "today's date" },
      },
    ],
  } as unknown as MaelstromResponse;
  const process = vi
    .spyOn(WebSocketConnector.prototype, 'process')
    .mockResolvedValue(response);
  diagnosticCapture.start('typed', 'session', 'provider');
  const connector = new DiagnosticConnector({ url: 'ws://localhost/ws' });
  expect(await connector.process(message)).toBe(response);
  expect(process).toHaveBeenCalledExactlyOnceWith(message);
  const events = JSON.parse(diagnosticCapture.export('')).events;
  expect(
    events.filter((event: { kind: string }) => event.kind === 'engine_request'),
  ).toHaveLength(1);
  expect(events).toContainEqual(
    expect.objectContaining({
      kind: 'engine_response',
      requestId: 'request',
      executionPlan: response.executionPlan,
    }),
  );
});

it('preserves Engine failures without recording error messages or retrying', async () => {
  const process = vi
    .spyOn(WebSocketConnector.prototype, 'process')
    .mockRejectedValue(new Error('private provider error'));
  const message = {
    id: MessageId('request'),
    sessionId: SessionId('session'),
    request: { context: { updateReasons: [] } },
  } as unknown as ChartRequestMessage;
  diagnosticCapture.start('typed', 'session', 'provider');
  await expect(
    new DiagnosticConnector({ url: 'ws://localhost/ws' }).process(message),
  ).rejects.toThrow('private provider error');
  expect(process).toHaveBeenCalledTimes(1);
  const trace = diagnosticCapture.export('');
  expect(trace).toContain('engine_error');
  expect(trace).not.toContain('private provider error');
});
