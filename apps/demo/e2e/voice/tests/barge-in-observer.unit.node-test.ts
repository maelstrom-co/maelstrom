import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BargeInObserverWindow,
  installBargeInObserver,
} from './barge-in-observer.ts';

function withObserver(
  check: (channel: EventTarget, target: BargeInObserverWindow) => void,
) {
  class Connection {
    createDataChannel(label: string) {
      return Object.assign(new EventTarget(), { label });
    }
  }
  const original = Connection.prototype.createDataChannel;
  const descriptors = ['window', 'RTCPeerConnection'].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  const target = {
    __voiceAudioTimeline: { sampleFrame: () => 1_024 },
  } as unknown as BargeInObserverWindow;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: target,
  });
  Object.defineProperty(globalThis, 'RTCPeerConnection', {
    configurable: true,
    value: Connection,
  });
  try {
    installBargeInObserver();
    check(new Connection().createDataChannel('oai-events'), target);
    target.__voiceBargeInObserver?.dispose();
    assert.equal(Connection.prototype.createDataChannel, original);
  } finally {
    target.__voiceBargeInObserver?.dispose();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

const send = (channel: EventTarget, payload: unknown) =>
  channel.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify(payload) }),
  );

test('records only bounded response lifecycle fields, never transcripts or credentials', () => {
  withObserver((channel, target) => {
    send(channel, {
      type: 'response.done',
      response: { id: 'r1', status: 'cancelled', output: ['private speech'] },
      credential: 'secret',
    });
    send(channel, {
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'private speech',
    });
    send(channel, { type: 'output_audio_buffer.cleared', response_id: 'r1' });
    assert.deepEqual(target.__voiceBargeInObserver?.snapshot(), {
      events: [
        {
          type: 'response.done',
          frame: 1_024,
          responseId: 'r1',
          status: 'cancelled',
        },
        {
          type: 'output_audio_buffer.cleared',
          frame: 1_024,
          responseId: 'r1',
          status: null,
        },
      ],
      dropped: 0,
    });
  });
});

test('ignores malformed events and unavailable clocks, and bounds retained evidence', () => {
  withObserver((channel, target) => {
    channel.dispatchEvent(new MessageEvent('message', { data: '{invalid' }));
    send(channel, null);
    target.__voiceAudioTimeline = { sampleFrame: () => null };
    send(channel, { type: 'output_audio_buffer.started', response_id: 'r1' });
    assert.equal(target.__voiceBargeInObserver?.snapshot().events.length, 0);
    target.__voiceAudioTimeline = { sampleFrame: () => 1_024 };
    for (let i = 0; i < 513; i++)
      send(channel, { type: 'output_audio_buffer.started', response_id: 'r1' });
    assert.equal(target.__voiceBargeInObserver?.snapshot().events.length, 512);
    assert.equal(target.__voiceBargeInObserver?.snapshot().dropped, 1);
  });
});

test('installation is idempotent and disposal detaches message listeners', () => {
  withObserver((channel, target) => {
    const observer = target.__voiceBargeInObserver;
    installBargeInObserver();
    assert.equal(target.__voiceBargeInObserver, observer);
    observer?.dispose();
    send(channel, { type: 'output_audio_buffer.started', response_id: 'r1' });
    assert.equal(observer?.snapshot().events.length, 0);
  });
});
