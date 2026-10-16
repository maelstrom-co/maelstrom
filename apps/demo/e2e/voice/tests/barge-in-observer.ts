export type BargeInPlaybackEvent = {
  readonly type:
    | 'output_audio_buffer.started'
    | 'output_audio_buffer.stopped'
    | 'output_audio_buffer.cleared'
    | 'response.done';
  readonly frame: number;
  readonly responseId: string | null;
  readonly status: 'completed' | 'cancelled' | 'failed' | 'incomplete' | null;
};

export type BargeInObserverSnapshot = {
  readonly events: readonly BargeInPlaybackEvent[];
  readonly dropped: number;
};

export type BargeInObserverWindow = Window & {
  __voiceAudioTimeline?: { sampleFrame(): number | null };
  __voiceBargeInObserver?: {
    snapshot(): BargeInObserverSnapshot;
    dispose(): void;
  };
};

export function installBargeInObserver(): void {
  const target = window as BargeInObserverWindow;
  if (target.__voiceBargeInObserver) return;
  const events: BargeInPlaybackEvent[] = [];
  let dropped = 0;
  const listeners = new Map<RTCDataChannel, (event: MessageEvent) => void>();
  const original = RTCPeerConnection.prototype.createDataChannel;
  const instrumented: typeof original = function (
    this: RTCPeerConnection,
    ...args
  ) {
    const channel = original.apply(this, args);
    if (channel.label !== 'oai-events') return channel;
    const listener = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || event.data.length > 1_048_576)
        return;
      let payload: {
        type?: unknown;
        response_id?: unknown;
        response?: { id?: unknown; status?: unknown };
      } | null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const type = payload?.type;
      if (
        type !== 'output_audio_buffer.started' &&
        type !== 'output_audio_buffer.stopped' &&
        type !== 'output_audio_buffer.cleared' &&
        type !== 'response.done'
      )
        return;
      const frame = target.__voiceAudioTimeline?.sampleFrame();
      if (frame === undefined || frame === null) return;
      if (events.length >= 512) {
        dropped++;
        return;
      }
      const id = payload?.response_id ?? payload?.response?.id;
      const status = payload?.response?.status;
      events.push({
        type,
        frame,
        responseId:
          typeof id === 'string' && id.length > 0 && id.length <= 256
            ? id
            : null,
        status:
          status === 'completed' ||
          status === 'cancelled' ||
          status === 'failed' ||
          status === 'incomplete'
            ? status
            : null,
      });
    };
    listeners.set(channel, listener);
    channel.addEventListener('message', listener);
    return channel;
  };
  RTCPeerConnection.prototype.createDataChannel = instrumented;
  target.__voiceBargeInObserver = {
    snapshot: () => ({ events: [...events], dropped }),
    dispose() {
      for (const [channel, listener] of listeners)
        channel.removeEventListener('message', listener);
      listeners.clear();
      if (RTCPeerConnection.prototype.createDataChannel === instrumented)
        RTCPeerConnection.prototype.createDataChannel = original;
      delete target.__voiceBargeInObserver;
    },
  };
}
