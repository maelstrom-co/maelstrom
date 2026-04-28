import { describe, expect, test } from 'bun:test';
import {
  ChartRequestMessage,
  InstanceId,
  MessageId,
  SessionId,
  type ChartRequest,
} from '@maelstrom-co/protocol';

import { adaptEnvelopeToLegacyRequest } from '../legacy-engine-adapter.js';

const buildEnvelope = (
  overrides: { id?: MessageId; sessionId?: SessionId; timestamp?: number } = {},
) => {
  const request: ChartRequest = {
    type: 'chart_request',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'show me' }],
      chartDimensions: { columns: 12, rows: 8 },
      layoutMode: 'grid',
    },
    instances: [
      {
        instanceId: InstanceId('vessel-1'),
        vesselId: 'v',
        variant: 'default',
      },
    ],
    vessels: [],
    layout: { type: 'grid', positions: [] },
  };
  return ChartRequestMessage({
    sessionId: overrides.sessionId ?? SessionId('session-X'),
    id: overrides.id ?? MessageId('msg-X'),
    timestamp: overrides.timestamp,
    request,
  });
};

describe('adaptEnvelopeToLegacyRequest', () => {
  test('lifts envelope.id onto the legacy request', () => {
    const envelope = buildEnvelope({ id: MessageId('lift-id') });
    const result = adaptEnvelopeToLegacyRequest(envelope);
    expect(result.id).toBe(envelope.id);
  });

  test('lifts envelope.sessionId onto context.sessionId', () => {
    const envelope = buildEnvelope({ sessionId: SessionId('lift-session') });
    const result = adaptEnvelopeToLegacyRequest(envelope);
    expect(result.context.sessionId).toBe(envelope.sessionId);
  });

  test('lifts envelope.timestamp onto context.timestamp', () => {
    const envelope = buildEnvelope({ timestamp: 1_700_000_000 });
    const result = adaptEnvelopeToLegacyRequest(envelope);
    expect(result.context.timestamp).toBe(1_700_000_000);
  });

  test('preserves the inner ChartRequest fields verbatim', () => {
    const envelope = buildEnvelope();
    const result = adaptEnvelopeToLegacyRequest(envelope);
    expect(result.type).toBe('chart_request');
    expect(result.context.layoutMode).toBe('grid');
    expect(result.context.chartDimensions).toEqual({ columns: 12, rows: 8 });
    expect(result.context.updateReasons).toEqual([
      { type: 'user_intent', intent: 'show me' },
    ]);
    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]?.instanceId).toBe(InstanceId('vessel-1'));
  });

  test('does not mutate the input envelope', () => {
    const envelope = buildEnvelope();
    const innerBefore = envelope.request;
    const contextBefore = envelope.request.context;

    adaptEnvelopeToLegacyRequest(envelope);

    expect(envelope.request).toBe(innerBefore);
    expect(envelope.request.context).toBe(contextBefore);
    expect('id' in envelope.request).toBe(false);
    expect('sessionId' in envelope.request.context).toBe(false);
    expect('timestamp' in envelope.request.context).toBe(false);
  });
});
