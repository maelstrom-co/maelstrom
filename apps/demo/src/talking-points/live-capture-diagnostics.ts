import type { LiveCaptureError } from './live-capture';
import type { TakePhase } from './live-take';
import { LIVE_TRANSCRIPTION_MODEL } from './live-transcription-config';

type Metadata = Readonly<Record<string, string | number | boolean>>;
type Listener = (kind: string, metadata: Metadata) => void;
type Callback = 'committed' | 'delta' | 'completed' | 'failed';
type Direction = RTCRtpTransceiverDirection | 'unavailable' | 'not-negotiated';
type Fact = boolean | 'unavailable';
export interface LiveCaptureTransportFacts {
  readonly transceiverDirection: Direction;
  readonly transceiverCurrentDirection: Direction;
  readonly transceiverStopped: Fact;
  readonly senderTrackPresent: Fact;
  readonly senderSameSource: Fact;
  readonly sourceLive: Fact;
  readonly sourceMuted: Fact;
  readonly sourceEnabled: Fact;
}
export interface LiveCaptureAudioStats {
  readonly outboundPackets?: number;
  readonly outboundBytes?: number;
  readonly sourceEnergy?: number;
  readonly sourceDuration?: number;
}

/** Take-owned scalar observations. No transcript or native event is retained here. */
export function createLiveCaptureDiagnostics(providerInstanceId: string) {
  let active = true;
  let snapshot: Metadata = {
    provider: 'talking-points-live-capture',
    providerInstanceId,
    providerGeneration: 1,
    sessionType: 'transcription',
    configuredModel: LIVE_TRANSCRIPTION_MODEL,
    configuredTurnMode: 'server_vad',
    phase: 'preparing',
    captureState: 'new',
    sdpApplied: false,
    providerConfirmed: false,
    observedSession: 0,
    observedSpeechStarted: 0,
    observedSpeechStopped: 0,
    observedCommitted: 0,
    observedDelta: 0,
    observedCompleted: 0,
    observedFailed: 0,
    observedErrors: 0,
    observedOther: 0,
    callbacksCommitted: 0,
    callbacksDelta: 0,
    callbacksCompleted: 0,
    callbacksFailed: 0,
    displayAccepted: 0,
    displaySuppressed: 0,
    displayUnchanged: 0,
  };
  const listeners = new Set<Listener>();
  let summary: ReturnType<typeof setTimeout> | undefined;
  let summaries = 0;
  let probe: (() => () => void) | undefined;
  let releaseProbe: (() => void) | undefined;
  function stopProbe() {
    const release = releaseProbe;
    releaseProbe = undefined;
    try {
      release?.();
    } catch {}
  }
  function startProbe() {
    if (!active || !listeners.size || !probe || releaseProbe) return;
    try {
      releaseProbe = probe();
    } catch {}
  }
  function emit(kind: string, change: Metadata = {}) {
    if (!active) return;
    snapshot = {
      ...snapshot,
      eventType: kind.replace(/^voice\./, ''),
      ...change,
    };
    for (const listener of listeners) {
      try {
        listener(kind, { ...snapshot });
      } catch {
        // Diagnostics must never participate in capture or semantic decisions.
      }
    }
  }
  function count(key: string) {
    if (active)
      snapshot = {
        ...snapshot,
        [key]: Math.min(
          Number.MAX_SAFE_INTEGER,
          Number(snapshot[key] ?? 0) + 1,
        ),
      };
  }
  function coalesce() {
    // Streaming summaries must not evict readiness/failure rows from the live ring.
    // Totals remain current in the scalar snapshot and every meaningful transition.
    if (!active || !listeners.size || summary !== undefined || summaries >= 8)
      return;
    summary = setTimeout(() => {
      summary = undefined;
      summaries++;
      emit('voice.capture.counters');
    }, 500);
  }
  return {
    getSnapshot: () => ({ ...snapshot }),
    subscribe(listener: Listener) {
      if (!active) return () => {};
      listeners.add(listener);
      try {
        listener('voice.capture.snapshot', { ...snapshot });
      } catch {}
      startProbe();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearTimeout(summary);
          summary = undefined;
          stopProbe();
        }
      };
    },
    setProbe(start?: () => () => void) {
      stopProbe();
      probe = active ? start : undefined;
      startProbe();
    },
    transport(facts: LiveCaptureTransportFacts) {
      emit('voice.capture.transport', {
        transceiverDirection: facts.transceiverDirection,
        transceiverCurrentDirection: facts.transceiverCurrentDirection,
        transceiverStopped: facts.transceiverStopped,
        senderTrackPresent: facts.senderTrackPresent,
        senderSameSource: facts.senderSameSource,
        sourceLive: facts.sourceLive,
        sourceMuted: facts.sourceMuted,
        sourceEnabled: facts.sourceEnabled,
      });
    },
    stats(sample: number, stats: LiveCaptureAudioStats = {}) {
      if (!active) return;
      const next = { ...snapshot };
      for (const key of [
        'outboundPackets',
        'outboundBytes',
        'sourceEnergy',
        'sourceDuration',
      ])
        delete next[key];
      snapshot = next;
      const finite = (n: number | undefined): n is number =>
        typeof n === 'number' && Number.isFinite(n) && n >= 0;
      const { outboundPackets, outboundBytes, sourceEnergy, sourceDuration } =
        stats;
      const outbound = finite(outboundPackets) && finite(outboundBytes);
      const source = finite(sourceEnergy) && finite(sourceDuration);
      emit('voice.capture.audio_stats', {
        statsSample: sample,
        outboundStats: outbound ? 'available' : 'unavailable',
        sourceStats: source ? 'available' : 'unavailable',
        ...(outbound
          ? {
              outboundPackets,
              outboundBytes,
            }
          : {}),
        ...(source
          ? {
              sourceEnergy,
              sourceDuration,
            }
          : {}),
      });
    },
    phase(phase: TakePhase) {
      emit('voice.capture.phase', { phase, eventType: phase });
    },
    captureState(
      captureState:
        | 'new'
        | 'starting'
        | 'ready'
        | 'capturing'
        | 'stopped'
        | 'disposed',
    ) {
      emit(
        captureState === 'ready'
          ? 'voice.capture.ready'
          : 'voice.capture.state',
        { captureState, eventType: captureState },
      );
    },
    control(sdpApplied: boolean, providerConfirmed: boolean) {
      emit('voice.capture.control', {
        sdpApplied,
        providerConfirmed,
        ...(providerConfirmed
          ? {
              confirmedModel: LIVE_TRANSCRIPTION_MODEL,
              confirmedTurnMode: 'server_vad',
              confirmedInputOnly: true,
            }
          : {}),
      });
    },
    microphone(enabled: boolean) {
      emit('voice.capture.microphone', {
        microphoneEnabled: enabled,
        eventType: enabled ? 'begin' : 'stop',
      });
    },
    peer(peerState: RTCPeerConnectionState) {
      const safe = [
        'new',
        'connecting',
        'connected',
        'disconnected',
        'failed',
        'closed',
      ].includes(peerState)
        ? peerState
        : 'unknown';
      emit('voice.capture.peer', { peerState: safe, eventType: safe });
    },
    channel(channelState: RTCDataChannelState) {
      const safe = ['connecting', 'open', 'closing', 'closed'].includes(
        channelState,
      )
        ? channelState
        : 'unknown';
      emit('voice.capture.channel', { channelState: safe, eventType: safe });
    },
    providerEvent(type: string) {
      const known: Record<string, string> = {
        'session.created': 'Session',
        'session.updated': 'Session',
        'input_audio_buffer.speech_started': 'SpeechStarted',
        'input_audio_buffer.speech_stopped': 'SpeechStopped',
        'input_audio_buffer.committed': 'Committed',
        'conversation.item.input_audio_transcription.delta': 'Delta',
        'conversation.item.input_audio_transcription.completed': 'Completed',
        'conversation.item.input_audio_transcription.failed': 'Failed',
        error: 'Errors',
      };
      const category = Object.hasOwn(known, type) ? known[type] : 'Other';
      count(`observed${category}`);
      if (category === 'Delta' || category === 'Other') coalesce();
      else emit('voice.provider.capture', { eventType: type });
    },
    finalCommit(outcome: 'sent' | 'unavailable' | 'empty-buffer' | 'rejected') {
      if (snapshot.finalCommit !== outcome)
        emit('voice.capture.final_commit', {
          finalCommit: outcome,
          eventType: outcome,
        });
    },
    failure(reason: LiveCaptureError['reason']) {
      emit('voice.capture.failed', {
        failureReason: reason,
        eventType: 'failed',
      });
    },
    callback(type: Callback) {
      const key = {
        committed: 'callbacksCommitted',
        delta: 'callbacksDelta',
        completed: 'callbacksCompleted',
        failed: 'callbacksFailed',
      }[type];
      count(key);
      if (type === 'delta') coalesce();
      else emit('voice.capture.callbacks', { eventType: type });
    },
    display(outcome: 'accepted' | 'suppressed' | 'unchanged') {
      count(
        {
          accepted: 'displayAccepted',
          suppressed: 'displaySuppressed',
          unchanged: 'displayUnchanged',
        }[outcome],
      );
      coalesce();
    },
    dispose() {
      active = false;
      clearTimeout(summary);
      summary = undefined;
      listeners.clear();
      stopProbe();
      probe = undefined;
    },
  };
}
export type LiveCaptureDiagnostics = ReturnType<
  typeof createLiveCaptureDiagnostics
>;
