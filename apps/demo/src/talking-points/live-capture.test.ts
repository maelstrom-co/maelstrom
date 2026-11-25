import { describe, expect, it, vi } from 'vitest';

import { createLiveCapture } from './live-capture';
import { createLiveCaptureDiagnostics } from './live-capture-diagnostics';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(diagnosticsEnabled = true) {
  const track = {
    id: 'PRIVATE_DEVICE_SOURCE',
    enabled: true,
    muted: false,
    readyState: 'live',
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const channel = {
    readyState: 'connecting',
    send: vi.fn(),
    close: vi.fn(),
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
  };
  const transceiver = {
    direction: 'sendrecv',
    currentDirection: 'sendonly' as RTCRtpTransceiverDirection | null,
    stopped: false,
    sender: {
      track,
      getStats: vi.fn(async () => new Map()),
    },
  };
  const peer = {
    connectionState: 'new',
    onconnectionstatechange: null as (() => void) | null,
    ontrack: null as ((event: { track: { stop: () => void } }) => void) | null,
    createDataChannel: vi.fn(() => channel),
    addTrack: vi.fn(() => transceiver.sender),
    getTransceivers: vi.fn(() => [transceiver]),
    localDescription: null as RTCSessionDescriptionInit | null,
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'local-sdp' })),
    setLocalDescription: vi.fn(async () => {
      peer.localDescription = { type: 'offer', sdp: 'applied-local-sdp' };
    }),
    setRemoteDescription: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const mintToken = vi.fn(async (_signal: AbortSignal) => ({
    value: 'ek_capture',
  }));
  const getUserMedia = vi.fn(async () => stream as unknown as MediaStream);
  const fetchMock = vi.fn(async () => new Response('answer-sdp'));
  const callbacks = {
    onCommitted: vi.fn(),
    onDelta: vi.fn(),
    onCompleted: vi.fn(),
    onTranscriptionFailed: vi.fn(),
    onFinalCommitIssue: vi.fn(),
    onFatalError: vi.fn(),
  };
  const diagnostics = createLiveCaptureDiagnostics('fixture-take');
  const capture = createLiveCapture(
    {
      mintToken,
      ...callbacks,
      diagnostics: diagnosticsEnabled ? diagnostics : undefined,
    },
    {
      getUserMedia,
      createPeerConnection: () => peer as unknown as RTCPeerConnection,
      fetch: fetchMock as unknown as typeof fetch,
    },
  );
  const event = (body: unknown) =>
    channel.onmessage?.({ data: JSON.stringify(body) });
  const session = {
    type: 'transcription',
    audio: {
      input: {
        transcription: { model: 'gpt-4o-transcribe' },
        turn_detection: { type: 'server_vad' },
      },
    },
  };
  async function ready() {
    const started = capture.start();
    await vi.waitFor(() =>
      expect(peer.setRemoteDescription).toHaveBeenCalled(),
    );
    channel.readyState = 'open';
    channel.onopen?.();
    event({ type: 'session.created', session });
    await started;
  }
  return {
    capture,
    diagnostics,
    track,
    stream,
    peer,
    transceiver,
    channel,
    callbacks,
    mintToken,
    getUserMedia,
    fetchMock,
    event,
    session,
    ready,
  };
}

describe('Talking Points input-only capture', () => {
  it('projects bounded metadata from real provider parsing without retaining content or allowing observer failures to affect capture', async () => {
    const f = fixture();
    const observations: { kind: string; metadata: object }[] = [];
    const releaseThrowing = f.diagnostics.subscribe(() => {
      throw new Error('observer');
    });
    const release = f.diagnostics.subscribe((kind, metadata) =>
      observations.push({ kind, metadata }),
    );
    await f.ready();
    f.capture.beginCapture();
    const canary = 'PRIVATE_TRANSCRIPT_SDP_192.0.2.1_DEVICE_GRANT';
    f.event({ type: 'input_audio_buffer.speech_started', item_id: canary });
    f.event({ type: 'input_audio_buffer.speech_stopped' });
    f.event({
      type: 'input_audio_buffer.committed',
      item_id: 'a',
      previous_item_id: null,
    });
    for (let i = 0; i < 1000; i++)
      f.event({
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'a',
        content_index: 0,
        delta: canary,
      });
    f.event({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'a',
      content_index: 0,
      transcript: canary,
    });
    f.event({
      type: 'conversation.item.input_audio_transcription.failed',
      item_id: 'b',
      content_index: 0,
      error: { message: canary },
    });
    f.event({ type: canary, body: canary });
    expect(f.callbacks.onDelta).toHaveBeenCalledTimes(1000);
    expect(f.callbacks.onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: canary }),
    );
    expect(f.callbacks.onTranscriptionFailed).toHaveBeenCalledOnce();
    expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
    expect(f.diagnostics.getSnapshot()).toMatchObject({
      captureState: 'capturing',
      sdpApplied: true,
      providerConfirmed: true,
      confirmedModel: 'gpt-4o-transcribe',
      observedSpeechStarted: 1,
      observedSpeechStopped: 1,
      observedCommitted: 1,
      observedDelta: 1000,
      observedCompleted: 1,
      observedFailed: 1,
      observedOther: 1,
    });
    expect(observations.length).toBeLessThan(25);
    expect(
      JSON.stringify([observations, f.diagnostics.getSnapshot()]),
    ).not.toContain(canary);
    f.capture.stopCapture();
    const commit = f.capture.commitFinalAudio();
    if (commit.status !== 'sent') throw new Error('commit not sent');
    f.event({
      type: 'error',
      error: {
        event_id: commit.eventId,
        code: 'input_audio_buffer_commit_empty',
        message: canary,
      },
    });
    expect(f.diagnostics.getSnapshot()).toMatchObject({
      finalCommit: 'empty-buffer',
      observedErrors: 1,
    });
    expect(JSON.stringify(observations)).not.toContain(canary);
    release();
    releaseThrowing();
    f.capture.dispose();
    f.diagnostics.dispose();
  });
  it('samples only the same negotiated audio sender while observed and rejects late detached samples', async () => {
    const f = fixture();
    await f.ready();
    vi.useFakeTimers();
    try {
      f.capture.beginCapture();
      expect(f.transceiver.sender.getStats).not.toHaveBeenCalled();
      const seen = vi.fn();
      const release = f.diagnostics.subscribe(seen);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.diagnostics.getSnapshot()).toMatchObject({
        transceiverDirection: 'sendrecv',
        transceiverCurrentDirection: 'sendonly',
        senderSameSource: true,
        sourceLive: true,
        sourceMuted: false,
        sourceEnabled: true,
        outboundStats: 'unavailable',
        sourceStats: 'unavailable',
      });
      expect(f.diagnostics.getSnapshot()).not.toHaveProperty('outboundPackets');
      expect(f.track.enabled).toBe(true);
      f.transceiver.sender.getStats.mockResolvedValue(
        new Map([
          [
            'out',
            {
              type: 'outbound-rtp',
              kind: 'audio',
              mediaSourceId: 'PRIVATE_SSRC',
              packetsSent: 12,
              bytesSent: 48,
              ssrc: 'PRIVATE_SSRC',
              address: '192.0.2.1',
            },
          ],
          [
            'PRIVATE_SSRC',
            {
              id: 'PRIVATE_SSRC',
              type: 'media-source',
              kind: 'audio',
              trackIdentifier: f.track.id,
              totalAudioEnergy: 0.5,
              totalSamplesDuration: 1,
            },
          ],
          ['video', { type: 'outbound-rtp', kind: 'video', packetsSent: 999 }],
        ]),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.diagnostics.getSnapshot()).toMatchObject({
        statsSample: 1,
        outboundStats: 'available',
        sourceStats: 'available',
        outboundPackets: 12,
        outboundBytes: 48,
        sourceEnergy: 0.5,
        sourceDuration: 1,
      });
      const pending = deferred<Map<string, unknown>>();
      f.transceiver.sender.getStats.mockReturnValue(pending.promise);
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.transceiver.sender.getStats).toHaveBeenCalledTimes(3);
      release();
      const before = seen.mock.calls.length;
      pending.resolve(new Map());
      await vi.advanceTimersByTimeAsync(10000);
      expect(seen).toHaveBeenCalledTimes(before);
      expect(f.transceiver.sender.getStats).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(f.diagnostics.getSnapshot())).not.toMatch(
        /PRIVATE|192\.0\.2/,
      );
      f.capture.stopCapture();
      expect(f.track.stop).toHaveBeenCalledOnce();
      f.capture.dispose();
      f.diagnostics.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not overlap sender stats across observer replacement or emit old results after Stop/disposal', async () => {
    const f = fixture();
    await f.ready();
    vi.useFakeTimers();
    try {
      const pending = deferred<Map<string, unknown>>();
      f.transceiver.sender.getStats.mockReturnValueOnce(pending.promise);
      const old = vi.fn();
      const release = f.diagnostics.subscribe(old);
      f.capture.beginCapture();
      expect(f.transceiver.sender.getStats).toHaveBeenCalledOnce();
      release();
      const replacement = vi.fn();
      const releaseReplacement = f.diagnostics.subscribe(replacement);
      expect(f.transceiver.sender.getStats).toHaveBeenCalledOnce();
      const beforeOld = old.mock.calls.length;
      pending.resolve(new Map());
      await vi.advanceTimersByTimeAsync(1000);
      expect(old).toHaveBeenCalledTimes(beforeOld);
      expect(f.transceiver.sender.getStats).toHaveBeenCalledTimes(2);
      const late = deferred<Map<string, unknown>>();
      f.transceiver.sender.getStats.mockReturnValueOnce(late.promise);
      await vi.advanceTimersByTimeAsync(1000);
      f.capture.stopCapture();
      const beforeStop = replacement.mock.calls.length;
      late.resolve(new Map());
      await vi.advanceTimersByTimeAsync(5000);
      expect(replacement).toHaveBeenCalledTimes(beforeStop);
      expect(vi.getTimerCount()).toBe(0);
      releaseReplacement();
      f.capture.dispose();
      f.diagnostics.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(['capture', 'diagnostics'] as const)(
    'invalidates a pending sample on %s disposal without delivering late metadata',
    async (owner) => {
      const f = fixture();
      await f.ready();
      vi.useFakeTimers();
      try {
        const pending = deferred<Map<string, unknown>>();
        f.transceiver.sender.getStats.mockReturnValue(pending.promise);
        const seen = vi.fn();
        f.diagnostics.subscribe(seen);
        f.capture.beginCapture();
        if (owner === 'capture') f.capture.dispose();
        else {
          f.diagnostics.dispose();
          expect(f.track.enabled).toBe(true);
          expect(f.track.stop).not.toHaveBeenCalled();
          expect(f.channel.close).not.toHaveBeenCalled();
        }
        const before = seen.mock.calls.length;
        pending.resolve(new Map());
        await vi.advanceTimersByTimeAsync(10000);
        expect(seen).toHaveBeenCalledTimes(before);
        expect(f.transceiver.sender.getStats).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
        f.capture.dispose();
        f.diagnostics.dispose();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it.each([
    'absent',
    'throws',
    'empty',
    'ambiguous',
    'non-finite',
    'wrong-source',
  ] as const)(
    'keeps %s audio stats unavailable rather than zero and never changes capture behavior',
    async (capability) => {
      const f = fixture();
      await f.ready();
      vi.useFakeTimers();
      try {
        if (capability === 'absent')
          f.transceiver.sender.getStats = undefined as never;
        if (capability === 'throws')
          f.transceiver.sender.getStats.mockRejectedValue(
            new Error('PRIVATE_STATS_ERROR'),
          );
        if (capability === 'ambiguous')
          f.transceiver.sender.getStats.mockResolvedValue(
            new Map([
              [
                'a',
                {
                  type: 'outbound-rtp',
                  kind: 'audio',
                  packetsSent: 10,
                  bytesSent: 20,
                },
              ],
              [
                'b',
                {
                  type: 'outbound-rtp',
                  kind: 'audio',
                  packetsSent: 30,
                  bytesSent: 40,
                },
              ],
            ]),
          );
        if (capability === 'non-finite')
          f.transceiver.sender.getStats.mockResolvedValue(
            new Map([
              [
                'a',
                {
                  type: 'outbound-rtp',
                  kind: 'audio',
                  packetsSent: NaN,
                  bytesSent: Infinity,
                },
              ],
            ]),
          );
        if (capability === 'wrong-source')
          f.transceiver.sender.track = {
            ...f.track,
            id: 'PRIVATE_OTHER_DEVICE',
          };
        const release = f.diagnostics.subscribe(() => {});
        f.capture.beginCapture();
        await vi.advanceTimersByTimeAsync(5000);
        expect(f.diagnostics.getSnapshot()).toMatchObject({
          statsSample: 2,
          outboundStats: 'unavailable',
          sourceStats: 'unavailable',
        });
        expect(f.diagnostics.getSnapshot()).not.toHaveProperty(
          'outboundPackets',
        );
        expect(f.diagnostics.getSnapshot()).not.toHaveProperty('sourceEnergy');
        expect(
          Object.keys(f.diagnostics.getSnapshot()).length,
        ).toBeLessThanOrEqual(64);
        expect(JSON.stringify(f.diagnostics.getSnapshot())).not.toContain(
          'PRIVATE',
        );
        expect(f.track.enabled).toBe(true);
        expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
        release();
        expect(vi.getTimerCount()).toBe(0);
        f.capture.stopCapture();
        expect(f.track.stop).toHaveBeenCalledOnce();
        expect(f.capture.commitFinalAudio().status).toBe('sent');
        f.capture.dispose();
        f.diagnostics.dispose();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('does not attribute source energy from a different track even in the same sender report', async () => {
    const f = fixture();
    await f.ready();
    f.transceiver.sender.getStats.mockResolvedValue(
      new Map([
        [
          'out',
          {
            type: 'outbound-rtp',
            kind: 'audio',
            mediaSourceId: 'source',
            packetsSent: 1,
            bytesSent: 2,
          },
        ],
        [
          'source',
          {
            id: 'source',
            type: 'media-source',
            kind: 'audio',
            trackIdentifier: 'PRIVATE_OTHER_DEVICE',
            totalAudioEnergy: 1,
            totalSamplesDuration: 2,
          },
        ],
      ]),
    );
    const release = f.diagnostics.subscribe(() => {});
    f.capture.beginCapture();
    await Promise.resolve();
    expect(f.diagnostics.getSnapshot()).toMatchObject({
      outboundStats: 'available',
      sourceStats: 'unavailable',
      outboundPackets: 1,
      outboundBytes: 2,
    });
    expect(f.diagnostics.getSnapshot()).not.toHaveProperty('sourceEnergy');
    release();
    f.capture.dispose();
    f.diagnostics.dispose();
  });
  it('negotiates ephemeral SDP only, then requires effective input-only/server_vad readiness before explicitly enabling the mic', async () => {
    const f = fixture();
    let ready = false;
    const started = f.capture.start().then((value) => {
      ready = true;
      return value;
    });
    await vi.waitFor(() =>
      expect(f.peer.setRemoteDescription).toHaveBeenCalled(),
    );
    expect(f.track.enabled).toBe(false);
    expect(() => f.capture.beginCapture()).toThrow();
    expect(f.peer.addTrack).toHaveBeenCalledWith(f.track, f.stream);
    expect(f.fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/calls',
      expect.objectContaining({
        method: 'POST',
        body: 'applied-local-sdp',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ek_capture',
          'Content-Type': 'application/sdp',
        },
      }),
    );
    f.channel.readyState = 'open';
    f.channel.onopen?.();
    await Promise.resolve();
    expect(ready).toBe(false);
    f.event({ type: 'session.created', session: f.session });
    expect(await started).toEqual({ inputOnly: true, turnMode: 'server_vad' });
    expect(f.track.enabled).toBe(false);
    f.capture.beginCapture();
    expect(f.track.enabled).toBe(true);
    expect(f.channel.send).not.toHaveBeenCalled();
    const remote = { stop: vi.fn() };
    f.peer.ontrack?.({ track: remote });
    expect(remote.stop).toHaveBeenCalledOnce();
    f.capture.dispose();
  });
  it.each(['missing-description', 'missing-sdp', 'empty-sdp'] as const)(
    'rejects %s after applying the local offer without posting an unapplied SDP',
    async (description) => {
      const f = fixture();
      f.peer.setLocalDescription.mockImplementation(async () => {
        f.peer.localDescription =
          description === 'missing-description'
            ? null
            : description === 'missing-sdp'
              ? { type: 'offer' }
              : { type: 'offer', sdp: '' };
      });
      const error = await f.capture.start().catch((error: unknown) => error);
      expect(error).toMatchObject({
        reason: 'sdp',
        message: 'Live transcription capture: sdp.',
      });
      expect(f.callbacks.onFatalError).toHaveBeenCalledExactlyOnceWith(error);
      expect(f.fetchMock).not.toHaveBeenCalled();
      expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
      expect(f.track.enabled).toBe(false);
      expect(f.track.stop).toHaveBeenCalledOnce();
      expect(f.channel.close).toHaveBeenCalledOnce();
      expect(f.peer.close).toHaveBeenCalledOnce();
      expect(f.channel.send).not.toHaveBeenCalled();
    },
  );

  it.each(['sendonly', 'sendrecv'] as const)(
    'accepts negotiated %s on the exact source sender, not the first transceiver, only after the answer applies',
    async (direction) => {
      const f = fixture();
      const answer = deferred<void>();
      f.transceiver.currentDirection = null;
      const unrelated = {
        ...f.transceiver,
        currentDirection: 'inactive' as const,
        sender: { ...f.transceiver.sender, track: { ...f.track } },
      };
      f.peer.getTransceivers.mockReturnValue([unrelated, f.transceiver]);
      f.peer.setRemoteDescription.mockImplementation(() => answer.promise);
      let settled = false;
      const started = f.capture.start().then((value) => {
        settled = true;
        return value;
      });
      await vi.waitFor(() =>
        expect(f.peer.setRemoteDescription).toHaveBeenCalled(),
      );
      f.channel.readyState = 'open';
      f.channel.onopen?.();
      f.event({ type: 'session.created', session: f.session });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
      f.transceiver.currentDirection = direction;
      answer.resolve();
      expect(await started).toEqual({
        inputOnly: true,
        turnMode: 'server_vad',
      });
      expect(f.track.enabled).toBe(false);
      expect(f.diagnostics.getSnapshot()).toMatchObject({
        senderSameSource: true,
        transceiverCurrentDirection: direction,
      });
      f.capture.beginCapture();
      expect(f.track.enabled).toBe(true);
      expect(f.channel.send).not.toHaveBeenCalled();
      f.capture.dispose();
    },
  );

  it.each([
    'missing-transceiver',
    'missing-sender',
    'null-sender',
    'null-track',
    'wrong-source',
    'ended-source',
    'stopped',
    'stopped-direction',
  ] as const)(
    'rejects %s after applying the answer without waiting for channel or configuration',
    async (attachment) => {
      const f = fixture(false);
      const unrelatedTrack = { ...f.track, stop: vi.fn() };
      if (attachment === 'missing-sender')
        f.peer.addTrack.mockReturnValue(undefined as never);
      f.peer.setRemoteDescription.mockImplementation(async () => {
        if (attachment === 'missing-transceiver')
          f.peer.getTransceivers.mockReturnValue([]);
        if (attachment === 'null-sender') f.transceiver.sender = null as never;
        if (attachment === 'null-track')
          f.transceiver.sender.track = null as never;
        if (attachment === 'wrong-source')
          f.transceiver.sender.track = unrelatedTrack;
        if (attachment === 'ended-source') f.track.readyState = 'ended';
        if (attachment === 'stopped') f.transceiver.stopped = true;
        if (attachment === 'stopped-direction')
          f.transceiver.direction = 'stopped';
      });
      const started = f.capture.start().catch((error: unknown) => error);
      await vi.waitFor(() =>
        expect(f.callbacks.onFatalError).toHaveBeenCalledOnce(),
      );
      expect(f.peer.setRemoteDescription).toHaveBeenCalledOnce();
      expect(await started).toMatchObject({ reason: 'readiness' });
      expect(f.callbacks.onFatalError).toHaveBeenCalledOnce();
      expect(f.track.enabled).toBe(false);
      expect(f.track.stop).toHaveBeenCalledOnce();
      expect(unrelatedTrack.stop).not.toHaveBeenCalled();
      expect(f.channel.close).toHaveBeenCalledOnce();
      expect(f.peer.close).toHaveBeenCalledOnce();
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(() => f.capture.beginCapture()).toThrow();
    },
  );

  it.each(['sendrecv', 'inactive'] as const)(
    'validates every owned source when the second source negotiates %s',
    async (direction) => {
      const f = fixture(false);
      const secondTrack = {
        ...f.track,
        id: 'SECOND_PRIVATE_SOURCE',
        stop: vi.fn(),
      };
      const secondSender = { ...f.transceiver.sender, track: secondTrack };
      const secondTransceiver = {
        ...f.transceiver,
        sender: secondSender,
        currentDirection: direction,
      };
      vi.spyOn(f.stream, 'getTracks').mockReturnValue([f.track, secondTrack]);
      vi.spyOn(f.stream, 'getAudioTracks').mockReturnValue([
        f.track,
        secondTrack,
      ]);
      f.peer.addTrack
        .mockReturnValueOnce(f.transceiver.sender)
        .mockReturnValueOnce(secondSender);
      f.peer.getTransceivers.mockReturnValue([
        secondTransceiver,
        f.transceiver,
      ]);
      const started = f.capture.start().catch((error: unknown) => error);
      await vi.waitFor(() =>
        expect(f.peer.setRemoteDescription).toHaveBeenCalled(),
      );
      f.channel.readyState = 'open';
      f.channel.onopen?.();
      f.event({ type: 'session.created', session: f.session });
      expect(f.peer.addTrack).toHaveBeenNthCalledWith(1, f.track, f.stream);
      expect(f.peer.addTrack).toHaveBeenNthCalledWith(2, secondTrack, f.stream);
      if (direction === 'inactive') {
        expect(await started).toMatchObject({ reason: 'readiness' });
        expect(f.callbacks.onFatalError).toHaveBeenCalledOnce();
        expect(() => f.capture.beginCapture()).toThrow();
        expect(f.track.stop).toHaveBeenCalledOnce();
        expect(secondTrack.stop).toHaveBeenCalledOnce();
      } else {
        expect(await started).toEqual({
          inputOnly: true,
          turnMode: 'server_vad',
        });
        expect(f.track.enabled).toBe(false);
        expect(secondTrack.enabled).toBe(false);
        f.capture.beginCapture();
        expect(f.track.enabled).toBe(true);
        expect(secondTrack.enabled).toBe(true);
        f.capture.dispose();
      }
      expect(f.channel.send).not.toHaveBeenCalled();
    },
  );

  it('never constructs an output sink and stops remote tracks even after disposal', async () => {
    const audio = vi.fn();
    const audioContext = vi.fn();
    vi.stubGlobal('Audio', audio);
    vi.stubGlobal('AudioContext', audioContext);
    try {
      const f = fixture();
      await f.ready();
      f.capture.beginCapture();
      const ontrack = f.peer.ontrack;
      const remote = { stop: vi.fn() };
      ontrack?.({ track: remote });
      expect(remote.stop).toHaveBeenCalledOnce();
      f.capture.dispose();
      const staleRemote = { stop: vi.fn() };
      ontrack?.({ track: staleRemote });
      expect(staleRemote.stop).toHaveBeenCalledOnce();
      expect(audio).not.toHaveBeenCalled();
      expect(audioContext).not.toHaveBeenCalled();
      expect(f.channel.send).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['inactive', 'recvonly', null] as const)(
    'rejects a negotiated %s answer even when configuration and channel arrive first, cleaning up without stale revival',
    async (direction) => {
      const f = fixture(false);
      const answer = deferred<void>();
      f.transceiver.currentDirection = null;
      f.peer.setRemoteDescription.mockImplementation(() => answer.promise);
      let settled = false;
      const started = f.capture.start().then(
        (value) => {
          settled = true;
          return value;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await vi.waitFor(() =>
        expect(f.peer.setRemoteDescription).toHaveBeenCalled(),
      );
      f.channel.readyState = 'open';
      f.channel.onopen?.();
      f.event({ type: 'session.created', session: f.session });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
      expect(f.track.enabled).toBe(false);
      const queuedMessage = f.channel.onmessage;
      const queuedOpen = f.channel.onopen;
      const queuedTrack = f.peer.ontrack;
      const queuedEnded = f.track.onended;
      f.transceiver.currentDirection = direction;
      answer.resolve();
      const error = await started;
      expect(error).toMatchObject({
        reason: 'readiness',
        message: 'Live transcription capture: readiness.',
      });
      expect(f.callbacks.onFatalError).toHaveBeenCalledExactlyOnceWith(error);
      expect(f.track.enabled).toBe(false);
      expect(f.track.stop).toHaveBeenCalledOnce();
      expect(f.mintToken.mock.calls[0][0].aborted).toBe(true);
      expect(f.channel.close).toHaveBeenCalledOnce();
      expect(f.peer.close).toHaveBeenCalledOnce();
      expect(() => f.capture.beginCapture()).toThrow();
      queuedOpen?.();
      queuedEnded?.();
      queuedMessage?.({
        data: JSON.stringify({ type: 'session.created', session: f.session }),
      });
      queuedMessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'stale',
          content_index: 0,
          transcript: 'PRIVATE_TRANSCRIPT',
        }),
      });
      const remote = { stop: vi.fn() };
      queuedTrack?.({ track: remote });
      expect(remote.stop).toHaveBeenCalledOnce();
      expect(f.callbacks.onCompleted).not.toHaveBeenCalled();
      expect(f.channel.send).not.toHaveBeenCalled();
      f.capture.dispose();
      expect(f.callbacks.onFatalError).toHaveBeenCalledOnce();
      expect(f.channel.close).toHaveBeenCalledOnce();
      expect(f.peer.close).toHaveBeenCalledOnce();
    },
  );

  it('stops capture immediately, keeps committed and completed identities separate, and settles out-of-order finals without replaying a VAD-raced commit', async () => {
    const f = fixture();
    await f.ready();
    f.capture.beginCapture();
    f.event({
      type: 'input_audio_buffer.committed',
      item_id: 'a',
      previous_item_id: null,
    });
    f.capture.stopCapture();
    expect(f.track.enabled).toBe(false);
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.channel.close).not.toHaveBeenCalled();
    expect(f.peer.close).not.toHaveBeenCalled();
    const commit = f.capture.commitFinalAudio();
    expect(commit.status).toBe('sent');
    if (commit.status !== 'sent') throw new Error('Commit was not sent');
    expect(f.channel.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'input_audio_buffer.commit',
        event_id: commit.eventId,
      }),
    );
    expect(f.callbacks.onCompleted).not.toHaveBeenCalled();
    f.event({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'b',
      content_index: 0,
      transcript: 'Second turn',
    });
    f.event({
      type: 'input_audio_buffer.committed',
      item_id: 'b',
      previous_item_id: 'a',
    });
    f.event({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'a',
      content_index: 1,
      transcript: 'First turn',
    });
    expect(f.callbacks.onCommitted.mock.calls.map(([event]) => event)).toEqual([
      { itemId: 'a', previousItemId: null },
      { itemId: 'b', previousItemId: 'a' },
    ]);
    expect(f.callbacks.onCompleted.mock.calls.map(([event]) => event)).toEqual([
      {
        itemId: 'b',
        contentIndex: 0,
        previousItemId: undefined,
        transcript: 'Second turn',
      },
      {
        itemId: 'a',
        contentIndex: 1,
        previousItemId: null,
        transcript: 'First turn',
      },
    ]);
    f.event({
      type: 'error',
      error: {
        event_id: commit.eventId,
        code: 'input_audio_buffer_commit_empty',
        message: 'Buffer empty',
      },
    });
    expect(f.callbacks.onFinalCommitIssue).toHaveBeenCalledWith({
      eventId: commit.eventId,
      reason: 'empty-buffer',
    });
    expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
    expect(f.capture.commitFinalAudio()).toEqual({ status: 'unavailable' });
    expect(f.channel.send).toHaveBeenCalledOnce();
    f.event({
      type: 'conversation.item.input_audio_transcription.failed',
      item_id: 'c',
      content_index: 0,
      error: { message: 'sensitive provider details' },
    });
    expect(f.callbacks.onTranscriptionFailed).toHaveBeenCalledWith({
      itemId: 'c',
      contentIndex: 0,
      previousItemId: undefined,
    });
    f.capture.dispose();
  });

  it('ignores a queued microphone-ended callback after intentional Stop so final events can still settle', async () => {
    const f = fixture();
    await f.ready();
    f.capture.beginCapture();
    const queuedEnded = f.track.onended;
    f.capture.stopCapture();
    queuedEnded?.();
    f.event({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'tail',
      content_index: 0,
      transcript: 'Tail',
    });
    expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
    expect(f.callbacks.onCompleted).toHaveBeenCalledOnce();
    expect(f.channel.close).not.toHaveBeenCalled();
    f.capture.dispose();
  });

  it('disposes immediately while permission is pending and stops late-acquired tracks without creating a connection', async () => {
    const f = fixture();
    const permission = deferred<MediaStream>();
    f.getUserMedia.mockReturnValue(permission.promise);
    const started = f.capture.start().catch((error: unknown) => error);
    f.capture.dispose();
    expect(await started).toMatchObject({ reason: 'disposed' });
    permission.resolve(f.stream as unknown as MediaStream);
    await Promise.resolve();
    expect(f.track.enabled).toBe(false);
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.mintToken).not.toHaveBeenCalled();
    expect(f.peer.createDataChannel).not.toHaveBeenCalled();
    expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
  });

  it.each([
    'grant',
    'offer',
    'local-description',
    'fetch',
    'answer-body',
    'remote-description',
  ] as const)(
    'invalidates setup during pending %s; late success cannot revive capture',
    async (stage) => {
      const f = fixture();
      const boundary = deferred<unknown>();
      if (stage === 'grant')
        f.mintToken.mockImplementation(async () => {
          await boundary.promise;
          return { value: 'ek_late' };
        });
      if (stage === 'offer')
        f.peer.createOffer.mockImplementation(async () => {
          await boundary.promise;
          return { type: 'offer', sdp: 'late-offer' };
        });
      if (stage === 'local-description')
        f.peer.setLocalDescription.mockImplementation(async () => {
          await boundary.promise;
        });
      if (stage === 'fetch')
        f.fetchMock.mockImplementation(async () => {
          await boundary.promise;
          return new Response('late-answer');
        });
      if (stage === 'answer-body')
        f.fetchMock.mockResolvedValue({
          ok: true,
          text: async () => {
            await boundary.promise;
            return 'late-answer';
          },
        } as Response);
      if (stage === 'remote-description')
        f.peer.setRemoteDescription.mockImplementation(async () => {
          await boundary.promise;
        });
      const started = f.capture.start().catch((error: unknown) => error);
      const called =
        stage === 'grant'
          ? f.mintToken
          : stage === 'offer'
            ? f.peer.createOffer
            : stage === 'local-description'
              ? f.peer.setLocalDescription
              : stage === 'remote-description'
                ? f.peer.setRemoteDescription
                : f.fetchMock;
      await vi.waitFor(() => expect(called).toHaveBeenCalled());
      const queuedMessage = f.channel.onmessage;
      const queuedOpen = f.channel.onopen;
      const queuedTrack = f.peer.ontrack;
      f.capture.dispose();
      expect(await started).toMatchObject({ reason: 'disposed' });
      expect(f.mintToken.mock.calls[0][0].aborted).toBe(true);
      boundary.resolve(undefined);
      await Promise.resolve();
      await Promise.resolve();
      f.channel.readyState = 'open';
      queuedOpen?.();
      queuedMessage?.({
        data: JSON.stringify({ type: 'session.created', session: f.session }),
      });
      queuedMessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'late',
          content_index: 0,
          transcript: 'late',
        }),
      });
      queuedMessage?.({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: 'late',
          content_index: 0,
          delta: 'late draft',
        }),
      });
      expect(f.callbacks.onDelta).not.toHaveBeenCalled();
      const output = { stop: vi.fn() };
      queuedTrack?.({ track: output });
      expect(output.stop).toHaveBeenCalledOnce();
      expect(f.track.enabled).toBe(false);
      expect(() => f.capture.beginCapture()).toThrow();
      expect(f.callbacks.onCompleted).not.toHaveBeenCalled();
      expect(f.callbacks.onFatalError).not.toHaveBeenCalled();
      expect(f.channel.close).toHaveBeenCalledOnce();
      expect(f.peer.close).toHaveBeenCalledOnce();
      if (stage !== 'remote-description')
        expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      type: 'realtime',
      audio: {
        input: {
          transcription: { model: 'gpt-4o-transcribe' },
          turn_detection: { type: 'server_vad' },
        },
      },
    },
    {
      type: 'transcription',
      audio: {
        input: {
          transcription: { model: 'gpt-live-transcribe' },
          turn_detection: { type: 'server_vad' },
        },
      },
    },
    {
      type: 'transcription',
      audio: {
        input: {
          transcription: { model: 'gpt-4o-transcribe' },
          turn_detection: null,
        },
      },
    },
  ])(
    'fails closed on incompatible effective configuration without ever enabling audio: %j',
    async (session) => {
      const f = fixture();
      const started = f.capture.start().catch((error: unknown) => error);
      await vi.waitFor(() =>
        expect(f.peer.setRemoteDescription).toHaveBeenCalled(),
      );
      f.channel.readyState = 'open';
      f.channel.onopen?.();
      f.event({ type: 'session.created', session });
      expect(await started).toMatchObject({ reason: 'readiness' });
      expect(f.callbacks.onFatalError).toHaveBeenCalledOnce();
      expect(f.track.enabled).toBe(false);
      expect(f.track.stop).toHaveBeenCalled();
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(f.peer.close).toHaveBeenCalledOnce();
    },
  );

  it.each(['microphone', 'grant', 'sdp'] as const)(
    'redacts %s startup failures and releases acquired resources',
    async (stage) => {
      const f = fixture();
      const sensitive = new Error('credential-or-provider-response');
      if (stage === 'microphone') f.getUserMedia.mockRejectedValue(sensitive);
      if (stage === 'grant') f.mintToken.mockRejectedValue(sensitive);
      if (stage === 'sdp')
        f.fetchMock.mockResolvedValue(
          new Response('credential-or-provider-response', { status: 403 }),
        );
      const error = await f.capture.start().catch((cause: unknown) => cause);
      expect(error).toMatchObject({ reason: stage });
      expect(String(error)).not.toContain('credential-or-provider-response');
      expect(f.callbacks.onFatalError).toHaveBeenCalledWith(error);
      expect(f.track.enabled).toBe(stage === 'microphone');
      if (stage !== 'microphone') {
        expect(f.track.stop).toHaveBeenCalled();
        expect(f.channel.close).toHaveBeenCalledOnce();
        expect(f.peer.close).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([
    'mic-ended',
    'channel-close',
    'channel-error',
    'peer-failed',
    'peer-disconnected',
    'configuration-change',
    'assistant-response',
    'provider-error',
    'malformed-event',
  ] as const)(
    'terminates visibly on %s with no manual/conversation fallback',
    async (event) => {
      const f = fixture();
      await f.ready();
      f.capture.beginCapture();
      if (event === 'mic-ended') f.track.onended?.();
      if (event === 'channel-close') f.channel.onclose?.();
      if (event === 'channel-error') f.channel.onerror?.();
      if (event === 'peer-failed' || event === 'peer-disconnected') {
        f.peer.connectionState =
          event === 'peer-failed' ? 'failed' : 'disconnected';
        f.peer.onconnectionstatechange?.();
      }
      if (event === 'configuration-change')
        f.event({ type: 'session.updated', session: { type: 'realtime' } });
      if (event === 'assistant-response') f.event({ type: 'response.created' });
      if (event === 'provider-error')
        f.event({ type: 'error', error: { message: 'sensitive detail' } });
      if (event === 'malformed-event')
        f.channel.onmessage?.({ data: '{broken' });
      expect(f.callbacks.onFatalError).toHaveBeenCalledOnce();
      expect(f.track.enabled).toBe(false);
      expect(f.track.stop).toHaveBeenCalled();
      expect(f.channel.close).toHaveBeenCalledOnce();
      expect(f.peer.close).toHaveBeenCalledOnce();
      expect(f.channel.send).not.toHaveBeenCalled();
      expect(f.capture.commitFinalAudio()).toEqual({ status: 'unavailable' });
      f.capture.dispose();
      expect(f.callbacks.onFatalError).toHaveBeenCalledOnce();
    },
  );

  it('classifies a correlated nonempty commit failure without reporting success or retrying', async () => {
    const f = fixture();
    await f.ready();
    f.capture.beginCapture();
    f.capture.stopCapture();
    const commit = f.capture.commitFinalAudio();
    if (commit.status !== 'sent') throw new Error('Commit was not sent');
    f.event({
      type: 'error',
      error: {
        event_id: commit.eventId,
        code: 'invalid_request_error',
        message: 'sensitive detail',
      },
    });
    expect(f.callbacks.onFinalCommitIssue).toHaveBeenCalledWith({
      eventId: commit.eventId,
      reason: 'rejected',
    });
    expect(f.callbacks.onCompleted).not.toHaveBeenCalled();
    expect(f.capture.commitFinalAudio()).toEqual({ status: 'unavailable' });
    expect(f.channel.send).toHaveBeenCalledOnce();
    f.capture.dispose();
  });

  it.each([
    { item_id: '', content_index: 0, delta: 'text' },
    { item_id: 'a', content_index: -1, delta: 'text' },
    { item_id: 'a', content_index: 0.5, delta: 'text' },
    { item_id: 'a', content_index: Number.MAX_SAFE_INTEGER + 1, delta: 'text' },
    { item_id: 'a', content_index: 0, delta: 42 },
  ])(
    'fails closed on malformed display delta identity or text: %j',
    async (event) => {
      const f = fixture();
      await f.ready();
      f.event({
        type: 'conversation.item.input_audio_transcription.delta',
        ...event,
      });
      expect(f.callbacks.onDelta).not.toHaveBeenCalled();
      expect(f.callbacks.onFatalError).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'protocol' }),
      );
    },
  );

  it('does not claim a sent commit when sending throws', async () => {
    const f = fixture();
    await f.ready();
    f.capture.stopCapture();
    f.channel.send.mockImplementation(() => {
      throw new Error('channel disappeared');
    });
    expect(f.capture.commitFinalAudio()).toEqual({ status: 'unavailable' });
    expect(f.callbacks.onFatalError).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'transport' }),
    );
  });
});
