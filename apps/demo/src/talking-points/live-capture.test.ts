import { describe, expect, it, vi } from 'vitest';

import { createLiveCapture } from './live-capture';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const track = {
    enabled: true,
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
  const peer = {
    connectionState: 'new',
    onconnectionstatechange: null as (() => void) | null,
    ontrack: null as ((event: { track: { stop: () => void } }) => void) | null,
    createDataChannel: vi.fn(() => channel),
    addTransceiver: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'local-sdp' })),
    setLocalDescription: vi.fn(async () => {}),
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
    onCompleted: vi.fn(),
    onTranscriptionFailed: vi.fn(),
    onFinalCommitIssue: vi.fn(),
    onFatalError: vi.fn(),
  };
  const capture = createLiveCapture(
    { mintToken, ...callbacks },
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
    track,
    stream,
    peer,
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
    expect(f.peer.addTransceiver).toHaveBeenCalledWith(f.track, {
      direction: 'sendonly',
      streams: [f.stream],
    });
    expect(f.fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/realtime/calls',
      expect.objectContaining({
        method: 'POST',
        body: 'local-sdp',
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
