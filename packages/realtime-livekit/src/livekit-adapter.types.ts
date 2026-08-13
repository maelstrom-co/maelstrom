import type { LiveKitTokenGrant } from '@maelstrom-co/realtime-protocol/livekit';
import type { BrowserVadOptions } from '@maelstrom-co/realtime-vad';

/** Options for constructing a {@link LiveKitAdapter}. */
export interface LiveKitAdapterOptions {
  /**
   * Mints a LiveKit grant for `roomName`. Injected (like `OpenAIAdapter`'s
   * `mintToken`) so this browser package stays free of any server-framework
   * coupling. The app owns how the grant is fetched. Wrap `mintLiveKitToken`
   * from `@maelstrom-co/realtime-livekit-server`.
   */
  readonly mintToken: (roomName: string) => Promise<LiveKitTokenGrant>;
  /**
   * Room the browser joins and the worker is dispatched to. Use a stable
   * per-session name so a reconnect rejoins the same room.
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
   * `0` to disable it.
   */
  readonly thinkingFallbackMs?: number;
  /**
   * How long `speakAssistantText` waits for the worker's `tts_ready` packet
   * before suppressing the greeting (default 10000ms). Test-only tightening.
   */
  readonly greetingReadyWaitMs?: number;
}
