import { withFetchTimeout } from '../lib/fetch-timeout';
import { LIVE_TRANSCRIPTION_MODEL } from './live-transcription-config';

/** Effective provider readiness, not permission to start sending microphone content. */
export interface LiveCaptureReady {
  readonly inputOnly: true;
  readonly turnMode: 'server_vad';
}

/** Provider item insertion order, independent of transcription completion order. */
export interface LiveCaptureCommitted {
  readonly itemId: string;
  readonly previousItemId: string | null;
}

/** A full final transcript replaces any partial text for this item/content pair. */
export interface LiveCaptureCompleted {
  readonly itemId: string;
  readonly contentIndex: number;
  /** Undefined when completion precedes the commit event; reconcile with onCommitted. */
  readonly previousItemId: string | null | undefined;
  readonly transcript: string;
}

/** An item/content failed; a commit acknowledgement is not a successful transcript. */
export interface LiveCaptureTranscriptionFailed {
  readonly itemId: string;
  readonly contentIndex: number;
  readonly previousItemId: string | null | undefined;
}

/** A correlated commit rejection; empty can mean silence or a server-VAD commit race. */
export interface LiveCaptureFinalCommitIssue {
  readonly eventId: string;
  readonly reason: 'empty-buffer' | 'rejected';
}

/** Redacted fatal failure, with no provider response body or credentials. */
export class LiveCaptureError extends Error {
  constructor(
    readonly reason:
      | 'disposed'
      | 'microphone'
      | 'grant'
      | 'sdp'
      | 'readiness'
      | 'transport'
      | 'protocol'
      | 'provider',
  ) {
    super(`Live transcription capture: ${reason}.`);
    this.name = 'LiveCaptureError';
  }
}

/** Application callbacks own evidence, finalization deadlines, and all semantic decisions. */
export interface LiveCaptureOptions {
  readonly mintToken: (
    signal: AbortSignal,
  ) => Promise<{ readonly value: string }>;
  readonly onCommitted: (event: LiveCaptureCommitted) => void;
  readonly onCompleted: (event: LiveCaptureCompleted) => void;
  readonly onTranscriptionFailed: (
    event: LiveCaptureTranscriptionFailed,
  ) => void;
  readonly onFinalCommitIssue: (event: LiveCaptureFinalCommitIssue) => void;
  readonly onFatalError: (error: LiveCaptureError) => void;
}

/** Only browser boundaries are injectable; no timers or application policy live here. */
export interface LiveCapturePlatform {
  readonly getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  readonly createPeerConnection: () => RTCPeerConnection;
  readonly fetch: typeof fetch;
}

/** A single-use capture connection. Disposing invalidates pending setup and all evidence callbacks. */
export interface LiveCapture {
  readonly start: () => Promise<LiveCaptureReady>;
  /** Call only after start resolves, at the application's timer origin. */
  readonly beginCapture: () => void;
  /** Stops tracks immediately but retains the channel for outstanding transcript events. */
  readonly stopCapture: () => void;
  /**
   * Sends at most one explicit commit after stopping. Sent is not acknowledged or flushed:
   * WebRTC audio/control ordering and server VAD can leave an incomplete tail.
   * The application must bound settling and reconcile committed/completed/failed events.
   */
  readonly commitFinalAudio: () =>
    | { readonly status: 'sent'; readonly eventId: string }
    | { readonly status: 'unavailable' };
  readonly dispose: () => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Creates a dedicated transcription-only WebRTC session, never a conversational adapter. */
export function createLiveCapture(
  options: LiveCaptureOptions,
  platform: Partial<LiveCapturePlatform> = {},
): LiveCapture {
  const controller = new AbortController();
  const getUserMedia =
    platform.getUserMedia ??
    ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
  const createPeer =
    platform.createPeerConnection ?? (() => new RTCPeerConnection());
  const doFetch = platform.fetch ?? fetch;
  let state:
    | 'new'
    | 'starting'
    | 'ready'
    | 'capturing'
    | 'stopped'
    | 'disposed' = 'new';
  let stream: MediaStream | undefined;
  let peer: RTCPeerConnection | undefined;
  let channel: RTCDataChannel | undefined;
  let startPromise: Promise<LiveCaptureReady> | undefined;
  let resolveStart: ((ready: LiveCaptureReady) => void) | undefined;
  let rejectStart: ((error: LiveCaptureError) => void) | undefined;
  let sdpApplied = false;
  let configured = false;
  let finalCommitEventId: string | undefined;
  const predecessors = new Map<string, string | null>();

  function stopTracks(source = stream) {
    for (const track of source?.getTracks() ?? []) {
      track.enabled = false;
      track.onended = null;
      track.stop();
    }
  }

  function terminate(error: LiveCaptureError) {
    if (state === 'disposed') return;
    state = 'disposed';
    controller.abort();
    stopTracks();
    if (channel) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.close();
    }
    if (peer) {
      peer.onconnectionstatechange = null;
      // Keep the stop-only ontrack handler: a queued remote track must never play.
      peer.close();
    }
    predecessors.clear();
    rejectStart?.(error);
  }

  function fail(reason: LiveCaptureError['reason']) {
    if (state === 'disposed') return;
    const error = new LiveCaptureError(reason);
    terminate(error);
    options.onFatalError(error);
  }

  function maybeReady() {
    if (
      state === 'starting' &&
      sdpApplied &&
      configured &&
      channel?.readyState === 'open'
    ) {
      state = 'ready';
      resolveStart?.({ inputOnly: true, turnMode: 'server_vad' });
    }
  }

  function handleMessage(data: unknown) {
    if (state === 'disposed') return;
    let event: unknown;
    try {
      if (typeof data !== 'string') throw new Error();
      event = JSON.parse(data);
    } catch {
      fail('protocol');
      return;
    }
    if (!record(event) || typeof event.type !== 'string') {
      fail('protocol');
      return;
    }
    if (event.type === 'session.created' || event.type === 'session.updated') {
      const session = event.session;
      const audio = record(session) && session.audio;
      const input = record(audio) && audio.input;
      if (
        !record(session) ||
        session.type !== 'transcription' ||
        !record(input) ||
        !record(input.transcription) ||
        input.transcription.model !== LIVE_TRANSCRIPTION_MODEL ||
        !record(input.turn_detection) ||
        input.turn_detection.type !== 'server_vad'
      ) {
        fail('readiness');
        return;
      }
      configured = true;
      maybeReady();
    } else if (event.type === 'input_audio_buffer.committed') {
      if (
        typeof event.item_id !== 'string' ||
        !event.item_id ||
        !(
          event.previous_item_id === null ||
          typeof event.previous_item_id === 'string'
        )
      ) {
        fail('protocol');
        return;
      }
      predecessors.set(event.item_id, event.previous_item_id);
      options.onCommitted({
        itemId: event.item_id,
        previousItemId: event.previous_item_id,
      });
    } else if (
      event.type === 'conversation.item.input_audio_transcription.completed' ||
      event.type === 'conversation.item.input_audio_transcription.failed'
    ) {
      if (
        typeof event.item_id !== 'string' ||
        !event.item_id ||
        typeof event.content_index !== 'number' ||
        !Number.isSafeInteger(event.content_index) ||
        event.content_index < 0
      ) {
        fail('protocol');
        return;
      }
      const identity = {
        itemId: event.item_id,
        contentIndex: event.content_index,
        previousItemId: predecessors.get(event.item_id),
      };
      if (event.type === 'conversation.item.input_audio_transcription.failed') {
        options.onTranscriptionFailed(identity);
      } else if (typeof event.transcript === 'string') {
        options.onCompleted({ ...identity, transcript: event.transcript });
      } else {
        fail('protocol');
      }
    } else if (event.type === 'error') {
      if (
        finalCommitEventId &&
        record(event.error) &&
        event.error.event_id === finalCommitEventId
      ) {
        options.onFinalCommitIssue({
          eventId: finalCommitEventId,
          reason:
            event.error.code === 'input_audio_buffer_commit_empty'
              ? 'empty-buffer'
              : 'rejected',
        });
      } else {
        fail('provider');
      }
    } else if (event.type.startsWith('response.')) {
      fail('readiness');
    }
  }

  async function setup() {
    let stage: LiveCaptureError['reason'] = 'microphone';
    try {
      const acquired = await getUserMedia({ audio: true });
      if (controller.signal.aborted) {
        stopTracks(acquired);
        return;
      }
      stream = acquired;
      for (const track of stream.getTracks()) {
        track.enabled = false;
        track.onended = () => {
          if (state !== 'stopped') fail('microphone');
        };
      }
      if (
        stream.getAudioTracks().length === 0 ||
        stream.getAudioTracks().some((track) => track.readyState === 'ended')
      ) {
        fail('microphone');
        return;
      }
      stage = 'transport';
      peer = createPeer();
      peer.ontrack = ({ track }) => track.stop();
      peer.onconnectionstatechange = () => {
        if (
          peer &&
          ['disconnected', 'failed', 'closed'].includes(peer.connectionState)
        )
          fail('transport');
      };
      channel = peer.createDataChannel('oai-events');
      channel.onopen = maybeReady;
      channel.onmessage = ({ data }) => handleMessage(data);
      channel.onclose = () => fail('transport');
      channel.onerror = () => fail('transport');
      for (const track of stream.getAudioTracks()) {
        peer.addTransceiver(track, {
          direction: 'sendonly',
          streams: [stream],
        });
      }
      stage = 'grant';
      const grant = await options.mintToken(controller.signal);
      if (controller.signal.aborted) return;
      stage = 'sdp';
      const offer = await peer.createOffer();
      if (controller.signal.aborted) return;
      await peer.setLocalDescription(offer);
      if (controller.signal.aborted) return;
      const answer = await doFetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${grant.value}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
        signal: withFetchTimeout(controller.signal),
      });
      if (controller.signal.aborted) return;
      if (!answer.ok) {
        fail('sdp');
        return;
      }
      const sdp = await answer.text();
      if (controller.signal.aborted) return;
      await peer.setRemoteDescription({ type: 'answer', sdp });
      if (controller.signal.aborted) return;
      sdpApplied = true;
      maybeReady();
    } catch {
      if (!controller.signal.aborted) fail(stage);
    }
  }

  return {
    start() {
      if (state === 'starting' && startPromise) return startPromise;
      if (state !== 'new')
        return Promise.reject(new LiveCaptureError('disposed'));
      state = 'starting';
      startPromise = new Promise((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      void setup();
      return startPromise;
    },
    beginCapture() {
      if (state !== 'ready') throw new LiveCaptureError('readiness');
      state = 'capturing';
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = true;
    },
    stopCapture() {
      if (state === 'new' || state === 'starting') {
        terminate(new LiveCaptureError('disposed'));
        return;
      }
      if (state === 'disposed' || state === 'stopped') return;
      state = 'stopped';
      stopTracks();
    },
    commitFinalAudio() {
      if (
        state !== 'stopped' ||
        channel?.readyState !== 'open' ||
        finalCommitEventId
      )
        return { status: 'unavailable' };
      finalCommitEventId = 'talking-points-final-commit';
      try {
        channel.send(
          JSON.stringify({
            type: 'input_audio_buffer.commit',
            event_id: finalCommitEventId,
          }),
        );
        return { status: 'sent', eventId: finalCommitEventId };
      } catch {
        fail('transport');
        return { status: 'unavailable' };
      }
    },
    dispose() {
      terminate(new LiveCaptureError('disposed'));
    },
  };
}
