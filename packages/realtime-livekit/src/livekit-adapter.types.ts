/** A LiveKit access token + room URL for a single room. */
export interface LiveKitTokenGrant {
  readonly token: string;
  readonly url: string;
}

/** Options for constructing a {@link LiveKitAdapter}. */
export interface LiveKitAdapterOptions {
  /**
   * Mints a LiveKit token + URL for `roomName`. Injected (like
   * `OpenAIAdapter`'s `mintToken`) so this browser package stays free of any
   * server-framework coupling — the app owns how the grant is fetched (a
   * TanStack Start server fn, a plain `fetch`, …). Wrap `mintLiveKitToken`
   * from `@maelstrom-co/realtime-livekit/server`.
   */
  readonly getToken: (roomName: string) => Promise<LiveKitTokenGrant>;
  /**
   * Room the browser joins and the worker is dispatched to. Any unique string
   * works — the worker auto-dispatches to whatever room it is assigned. Use a
   * stable per-session name so a reconnect rejoins the same room.
   */
  readonly roomName: string;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
  /**
   * How long (ms) to wait in `thinking` after `endTurn` before assuming the
   * turn was empty (an accidental tap with no speech) and collapsing back to
   * `connected`. With no server-side VAD, an empty turn produces no worker
   * response, so without this the UI would wedge in `thinking` forever. Any
   * real activity (a transcript, a TTS signal, a barge-in, disconnect) cancels
   * the fallback. Defaults to 10000; set `0` to disable it (e.g. in tests).
   */
  readonly thinkingFallbackMs?: number;
}
