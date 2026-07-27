/**
 * `@maelstrom-co/realtime-livekit-server` — server-only, transport-agnostic
 * logic for minting LiveKit room access tokens.
 *
 * The server sibling of `@maelstrom-co/realtime-livekit`: the browser package
 * declares the `LiveKitTokenGrant` contract the adapter consumes, and this
 * package implements it. It is the
 * only side that touches `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, and it
 * never ships to the browser. Wiring the minter into a route (method checks,
 * body parsing, status codes) is the caller's responsibility — see
 * {@link mintLiveKitToken}.
 */

// The shared mint vocabulary lives in `@maelstrom-co/realtime`; re-exported
// here so a consumer wiring a LiveKit mint route pulls everything it needs
// from one entry point.
export type { MintFailure, MintFailureReason } from '@maelstrom-co/realtime';
export { mintFailureHttpStatus } from '@maelstrom-co/realtime';
export type {
  LiveKitMintResult,
  LiveKitTokenRequest,
} from './lib/livekit-mint.js';
export {
  LiveKitTokenRequestSchema,
  mintLiveKitToken,
} from './lib/livekit-mint.js';
