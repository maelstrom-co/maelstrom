import { expect, test } from 'bun:test';
import { MicrophonePublicationGate } from './microphone-publication-gate.js';

test('MicrophonePublicationGate restores unique tracks to exact prior state', () => {
  const enabled = { enabled: true } as MediaStreamTrack;
  const disabled = { enabled: false } as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [enabled, disabled, enabled],
  } as unknown as MediaStream;
  const gate = new MicrophonePublicationGate(() => 1);
  const lease = gate.acquire(stream, 1);
  expect([enabled.enabled, disabled.enabled]).toEqual([false, false]);
  lease.release();
  lease.release();
  expect([enabled.enabled, disabled.enabled]).toEqual([true, false]);
});

test('stale-generation release is a no-op', () => {
  let generation = 1;
  const track = { enabled: true } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const gate = new MicrophonePublicationGate(() => generation);
  const lease = gate.acquire(stream, generation);
  generation = 2;
  lease.release();
  expect(track.enabled).toBe(false);
  const successor = gate.acquire(stream, generation);
  expect(track.enabled).toBe(false);
  successor.release();
  expect(track.enabled).toBe(true);
});

test('replacement lease prevents stale release from restoring over the current gate', () => {
  const track = { enabled: true } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const gate = new MicrophonePublicationGate(() => 2);
  const first = gate.acquire(stream, 1);
  const second = gate.acquire(stream, 2);
  first.release();
  expect(track.enabled).toBe(false);
  second.release();
  expect(track.enabled).toBe(true);
});
