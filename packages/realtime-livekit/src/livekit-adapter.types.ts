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
}
