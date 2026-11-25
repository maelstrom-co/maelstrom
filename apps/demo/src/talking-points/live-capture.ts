import { withFetchTimeout } from '../lib/fetch-timeout';
import type { LiveCaptureDiagnostics } from './live-capture-diagnostics';
import { LIVE_TRANSCRIPTION_MODEL } from './live-transcription-config';

/** Effective provider readiness, not permission to start sending microphone content. */
export interface LiveCaptureReady {
  readonly inputOnly: true;
  readonly turnMode: 'server_vad';
}

/** Provider item insertion order, independent of transcription completion order. */
export interface LiveCaptureCommitted {
  readonly itemId: string;
  readonly previousItemId: string | null | undefined;
}

/** Display-only text appended to an unfinished item/content pair, never semantic evidence. */
export interface LiveCaptureDelta {
  readonly itemId: string;
  readonly contentIndex: number;
  readonly delta: string;
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
  /** Optional take-owned, metadata-only observation; never controls capture. */
  readonly diagnostics?: LiveCaptureDiagnostics;
  readonly mintToken: (
    signal: AbortSignal,
  ) => Promise<{ readonly value: string }>;
  readonly onCommitted: (event: LiveCaptureCommitted) => void;
  readonly onDelta: (event: LiveCaptureDelta) => void;
  readonly onCompleted: (event: LiveCaptureCompleted) => void;
  readonly onTranscriptionFailed: (
    event: LiveCaptureTranscriptionFailed,
  ) => void;
  readonly onFinalCommitIssue: (event: LiveCaptureFinalCommitIssue) => void;
  readonly onFatalError: (error: LiveCaptureError) => void;
}

/** Injectable browser boundaries, independent of application finalization policy. */
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
  const diagnostics = options.diagnostics;
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
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  let sdpApplied = false;
  let configured = false;
  let finalCommitEventId: string | undefined;
  const predecessors = new Map<string, string | null | undefined>();
  const audioSources: {
    source: MediaStreamTrack;
    sender: RTCRtpSender;
  }[] = [];
  let statsPending = false;

  function audioSender() {
    const attachment = audioSources.length === 1 ? audioSources[0] : undefined;
    const transceiver = attachment
      ? peer
          ?.getTransceivers()
          .find(({ sender }) => sender === attachment.sender)
      : undefined;
    return { transceiver, source: attachment?.source };
  }

  function observeTransport() {
    if (!diagnostics) return;
    const unavailable = {
      transceiverDirection: 'unavailable',
      transceiverCurrentDirection: 'unavailable',
      transceiverStopped: 'unavailable',
      senderTrackPresent: 'unavailable',
      senderSameSource: 'unavailable',
      sourceLive: 'unavailable',
      sourceMuted: 'unavailable',
      sourceEnabled: 'unavailable',
    } as const;
    try {
      const { transceiver, source } = audioSender();
      const stopped =
        transceiver && 'stopped' in transceiver
          ? transceiver.stopped
          : undefined;
      const direction = (value: unknown) =>
        value === 'sendonly' ||
        value === 'sendrecv' ||
        value === 'recvonly' ||
        value === 'inactive' ||
        value === 'stopped'
          ? value
          : 'unavailable';
      diagnostics.transport({
        transceiverDirection: direction(transceiver?.direction),
        transceiverCurrentDirection:
          transceiver?.currentDirection === null
            ? 'not-negotiated'
            : direction(transceiver?.currentDirection),
        transceiverStopped:
          typeof stopped === 'boolean' ? stopped : 'unavailable',
        senderTrackPresent: transceiver?.sender
          ? !!transceiver.sender.track
          : 'unavailable',
        senderSameSource:
          source && transceiver?.sender
            ? transceiver.sender.track === source
            : 'unavailable',
        sourceLive: source ? source.readyState === 'live' : 'unavailable',
        sourceMuted:
          typeof source?.muted === 'boolean' ? source.muted : 'unavailable',
        sourceEnabled:
          typeof source?.enabled === 'boolean' ? source.enabled : 'unavailable',
      });
    } catch {
      diagnostics.transport(unavailable);
    }
  }

  function observeAudio() {
    let observing = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function sample(index: number) {
      if (!observing || state !== 'capturing') return;
      let projected: {
        outboundPackets?: number;
        outboundBytes?: number;
        sourceEnergy?: number;
        sourceDuration?: number;
      } = {};
      try {
        const { transceiver, source } = audioSender();
        const sender = transceiver?.sender;
        if (
          !statsPending &&
          source &&
          sender?.track === source &&
          typeof sender.getStats === 'function'
        ) {
          statsPending = true;
          let reports: RTCStatsReport;
          try {
            reports = await sender.getStats();
          } finally {
            statsPending = false;
          }
          if (!observing || state !== 'capturing') return;
          const outbound: Record<string, unknown>[] = [];
          const sources: Record<string, unknown>[] = [];
          reports.forEach((row: unknown) => {
            if (!record(row)) return;
            if (
              row.type === 'outbound-rtp' &&
              (row.kind === 'audio' || row.mediaType === 'audio')
            )
              outbound.push(row);
            if (
              row.type === 'media-source' &&
              row.kind === 'audio' &&
              row.trackIdentifier === source.id
            )
              sources.push(row);
          });
          const sent = outbound.length === 1 ? outbound[0] : undefined;
          const audio = sources.length === 1 ? sources[0] : undefined;
          if (sent)
            projected = {
              outboundPackets:
                typeof sent.packetsSent === 'number'
                  ? sent.packetsSent
                  : undefined,
              outboundBytes:
                typeof sent.bytesSent === 'number' ? sent.bytesSent : undefined,
            };
          if (
            sent &&
            audio &&
            typeof audio.id === 'string' &&
            sent.mediaSourceId === audio.id
          )
            projected = {
              ...projected,
              sourceEnergy:
                typeof audio.totalAudioEnergy === 'number'
                  ? audio.totalAudioEnergy
                  : undefined,
              sourceDuration:
                typeof audio.totalSamplesDuration === 'number'
                  ? audio.totalSamplesDuration
                  : undefined,
            };
        }
      } catch {
        // Unsupported or unattributable stats are unknown, not zero audio.
      }
      if (!observing || state !== 'capturing') return;
      diagnostics?.stats(index, projected);
      if (index < 2)
        timer = setTimeout(() => {
          void sample(index + 1);
        }, 1000);
    }
    observeTransport();
    void sample(0);
    return () => {
      observing = false;
      clearTimeout(timer);
    };
  }

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
    clearTimeout(readinessTimer);
    diagnostics?.setProbe();
    diagnostics?.captureState(state);
    controller.abort();
    stopTracks();
    diagnostics?.microphone(false);
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
    diagnostics?.failure(reason);
    terminate(error);
    options.onFatalError(error);
  }

  function maybeReady() {
    if (state !== 'starting' || !sdpApplied) return;
    const transceivers = peer?.getTransceivers() ?? [];
    if (
      !audioSources.every(({ source, sender }) => {
        const transceiver = transceivers.find(
          (entry) => entry.sender === sender,
        );
        return (
          source.readyState === 'live' &&
          sender?.track === source &&
          transceiver &&
          transceiver.direction !== 'stopped' &&
          !('stopped' in transceiver && transceiver.stopped === true) &&
          (transceiver.currentDirection === 'sendonly' ||
            transceiver.currentDirection === 'sendrecv')
        );
      })
    ) {
      fail('readiness');
      return;
    }
    if (configured && channel?.readyState === 'open') {
      state = 'ready';
      clearTimeout(readinessTimer);
      diagnostics?.captureState(state);
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
    diagnostics?.providerEvent(event.type);
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
      diagnostics?.control(sdpApplied, configured);
      maybeReady();
    } else if (event.type === 'input_audio_buffer.committed') {
      if (
        typeof event.item_id !== 'string' ||
        !event.item_id ||
        !(
          event.previous_item_id === undefined ||
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
      event.type === 'conversation.item.input_audio_transcription.delta' ||
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
      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        if (typeof event.delta === 'string') {
          options.onDelta({
            itemId: event.item_id,
            contentIndex: event.content_index,
            delta: event.delta,
          });
        } else {
          fail('protocol');
        }
      } else if (
        event.type === 'conversation.item.input_audio_transcription.failed'
      ) {
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
        diagnostics?.finalCommit(
          event.error.code === 'input_audio_buffer_commit_empty'
            ? 'empty-buffer'
            : 'rejected',
        );
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
      diagnostics?.peer(peer.connectionState);
      peer.onconnectionstatechange = () => {
        if (state === 'disposed') return;
        if (peer) diagnostics?.peer(peer.connectionState);
        if (
          peer &&
          ['disconnected', 'failed', 'closed'].includes(peer.connectionState)
        )
          fail('transport');
      };
      channel = peer.createDataChannel('oai-events');
      diagnostics?.channel(channel.readyState);
      channel.onopen = () => {
        if (state === 'disposed') return;
        if (channel) diagnostics?.channel(channel.readyState);
        maybeReady();
      };
      channel.onmessage = ({ data }) => handleMessage(data);
      channel.onclose = () => {
        if (state === 'disposed') return;
        diagnostics?.channel('closed');
        fail('transport');
      };
      channel.onerror = () => fail('transport');
      for (const track of stream.getAudioTracks()) {
        audioSources.push({
          source: track,
          sender: peer.addTrack(track, stream),
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
      const localSdp = peer.localDescription?.sdp;
      if (!localSdp) {
        fail('sdp');
        return;
      }
      const answer = await doFetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${grant.value}`,
          'Content-Type': 'application/sdp',
        },
        body: localSdp,
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
      readinessTimer = setTimeout(() => fail('readiness'), 10000);
      diagnostics?.control(sdpApplied, configured);
      observeTransport();
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
      diagnostics?.captureState(state);
      if (state === 'starting') void setup();
      return startPromise;
    },
    beginCapture() {
      if (state !== 'ready') throw new LiveCaptureError('readiness');
      state = 'capturing';
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = true;
      diagnostics?.captureState(state);
      diagnostics?.microphone(true);
      observeTransport();
      diagnostics?.setProbe(observeAudio);
    },
    stopCapture() {
      if (state === 'new' || state === 'starting') {
        terminate(new LiveCaptureError('disposed'));
        return;
      }
      if (state === 'disposed' || state === 'stopped') return;
      state = 'stopped';
      diagnostics?.setProbe();
      stopTracks();
      observeTransport();
      diagnostics?.captureState(state);
      diagnostics?.microphone(false);
    },
    commitFinalAudio() {
      if (
        state !== 'stopped' ||
        channel?.readyState !== 'open' ||
        finalCommitEventId
      ) {
        if (state !== 'disposed') diagnostics?.finalCommit('unavailable');
        return { status: 'unavailable' };
      }
      finalCommitEventId = 'talking-points-final-commit';
      try {
        channel.send(
          JSON.stringify({
            type: 'input_audio_buffer.commit',
            event_id: finalCommitEventId,
          }),
        );
        diagnostics?.finalCommit('sent');
        return { status: 'sent', eventId: finalCommitEventId };
      } catch {
        diagnostics?.finalCommit('unavailable');
        fail('transport');
        return { status: 'unavailable' };
      }
    },
    dispose() {
      terminate(new LiveCaptureError('disposed'));
    },
  };
}
