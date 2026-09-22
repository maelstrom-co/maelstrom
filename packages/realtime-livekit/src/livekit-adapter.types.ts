import type { LiveKitTokenGrant } from '@maelstrom-co/realtime-protocol/livekit';
import type { BrowserVadOptions } from '@maelstrom-co/realtime-vad';

/** Options for constructing a {@link LiveKitAdapter}. */
export interface LiveKitAdapterOptions {
  /**
   * Mints a LiveKit grant for `roomName`. Injected (like `OpenAIAdapter`'s
   * `mintToken`) so this browser package stays free of any server-framework
   * coupling. The app owns how the grant is fetched. Wrap `mintLiveKitToken`
   * from `@maelstrom-co/realtime-livekit-server`.
   * Normal mode calls this with one argument. Trigger mode adds `{ trigger: true }`;
   * forward that opt-in and return the trusted grant's trigger binding. A legacy
   * callback that omits the binding fails before negotiation or microphone capture
   * in trigger mode, while remaining supported in normal mode.
   */
  readonly mintToken: (
    roomName: string,
    context?: {
      /** Requests a fresh named-worker bootstrap rather than normal automatic dispatch. */
      readonly trigger: true;
    },
  ) => Promise<LiveKitTokenGrant>;
  /**
   * Normal-mode room, or trigger-mode request namespace. Trigger grants select a
   * fresh effective room through the signed token on each explicit connect;
   * SDK-managed reconnects retain that room and its worker binding.
   */
  readonly roomName: string;
  /**
   * Browser VAD policy. Detection is on unless you turn it off, so a session
   * that never sets this detects turns by itself and exposes no `turnControl`.
   *
   * Only `false` selects manual mode outright. It loads no VAD or pre-roll
   * worklets and fetches no assets. A hold-to-talk button therefore renders in
   * exactly two situations: that setting, or degradation from a detector that
   * failed.
   *
   * Degrading is conditional on safety. If VAD setup, its runtime, or one of
   * its callbacks fails and upstream audio can still be paused, the live
   * session drops to manual mode and `turnControl` appears. If audio cannot be
   * stopped safely, or token minting, room connection, track publication, a
   * required data channel, or unexpected disconnection handling fails, the
   * session fails instead.
   *
   * @example Each accepted form
   * ```ts
   * new LiveKitAdapter({ mintToken, roomName }); // automatic, defaults
   * new LiveKitAdapter({ mintToken, roomName, vad: true }); // the same
   * new LiveKitAdapter({ mintToken, roomName, vad: { preRollMs: 300 } });
   * new LiveKitAdapter({ mintToken, roomName, vad: false }); // manual turns
   * ```
   */
  readonly vad?: boolean | BrowserVadOptions;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
  /**
   * How long (ms) to wait in `thinking` after `endTurn` before assuming the
   * turn was empty and collapsing back to `connected`. Defaults to 10000; set
   * `0` to disable it. Ignored in trigger mode, which uses explicit correlated
   * terminals and the negotiated worker drain budget plus 5000 ms delivery.
   */
  readonly thinkingFallbackMs?: number;
  /**
   * How long `speakAssistantText` waits for the worker's `tts_ready` packet
   * before suppressing the greeting (default 10000ms). Test-only tightening.
   * Trigger mode never presents a greeting and does not use this wait.
   */
  readonly greetingReadyWaitMs?: number;
}
