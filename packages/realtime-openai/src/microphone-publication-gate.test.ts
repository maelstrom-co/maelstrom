import { expect, test } from 'bun:test';

import {
  MicrophonePublicationGate,
  MicrophoneTrackHolds,
} from './microphone-publication-gate.js';

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

test('gates sharing track holds restore one prior value in either release order', () => {
  const enabled = { enabled: true } as MediaStreamTrack;
  const disabled = { enabled: false } as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [enabled, disabled],
  } as unknown as MediaStream;
  const holds = new MicrophoneTrackHolds();
  const first = new MicrophonePublicationGate(() => 1, holds);
  const second = new MicrophonePublicationGate(() => 1, holds);

  const outer = first.acquire(stream, 1);
  const inner = second.acquire(stream, 1);
  outer.release();
  expect([enabled.enabled, disabled.enabled]).toEqual([false, false]);
  inner.release();
  expect([enabled.enabled, disabled.enabled]).toEqual([true, false]);

  const again = first.acquire(stream, 1);
  const replacement = first.acquire(stream, 1);
  again.release();
  expect(enabled.enabled).toBe(false);
  replacement.release();
  expect([enabled.enabled, disabled.enabled]).toEqual([true, false]);
});
