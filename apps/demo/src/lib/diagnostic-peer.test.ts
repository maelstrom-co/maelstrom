import { afterEach, expect, it, vi } from 'vitest';
import { createDiagnosticPeer, diagnosticCapture } from './diagnostic-capture';

afterEach(() => {
  vi.unstubAllGlobals();
  diagnosticCapture.clear();
});

it('observes native delegation and continuation without duplicating or replacing channel messages', () => {
  const channel = new EventTarget() as EventTarget & {
    send: (data: string) => void;
  };
  const sent: string[] = [];
  channel.send = (data) => {
    sent.push(data);
  };
  class Peer {
    createDataChannel() {
      return channel;
    }
  }
  vi.stubGlobal('RTCPeerConnection', Peer);
  const peer = createDiagnosticPeer();
  const observed = peer.createDataChannel('events');
  diagnosticCapture.start('live', 'session', 'provider');
  const received = vi.fn();
  observed.addEventListener('message', received);
  const delegation = JSON.stringify({
    type: 'session.delegation.created',
    delegation: { id: 'delegation', response_id: 'response' },
  });
  channel.dispatchEvent(new MessageEvent('message', { data: delegation }));
  const command = JSON.stringify({
    type: 'response.create',
    event_id: 'continue',
  });
  observed.send(command);
  expect(sent).toEqual([command]);
  expect(received).toHaveBeenCalledTimes(1);
  const events = JSON.parse(diagnosticCapture.export('')).events;
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'session.delegation.created',
      delegationId: 'delegation',
      responseId: 'response',
      direction: 'received',
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'response.create', direction: 'sent' }),
  );
});
