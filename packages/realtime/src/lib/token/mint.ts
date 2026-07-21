/**
 * Fetch implementation a minter calls upstream with. Defaults to the global
 * `fetch`; a server-side minter accepts one so tests can inject a fake and
 * avoid a real network call.
 */
export type MintFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Why a token-mint attempt failed. Provider-agnostic so every server-side
 * minter reports the same vocabulary; callers map each reason to their own
 * transport status — see {@link mintFailureHttpStatus}.
 *
 * - `invalid-request` — the request body failed the minter's input schema.
 * - `unsupported-provider` — the request targeted a provider this minter
 *   does not handle.
 * - `missing-api-key` — the minter was constructed without provider
 *   credentials.
 * - `upstream-failure` — the provider was unreachable, rejected the request,
 *   or returned a response the minter could not validate.
 */
export type MintFailureReason =
  | 'invalid-request'
  | 'unsupported-provider'
  | 'missing-api-key'
  | 'upstream-failure';

/**
 * Failure detail for a mint call. `upstreamStatus` is only ever present when
 * `reason` is `upstream-failure`, and even then only when the provider
 * returned an HTTP response (it's absent when the upstream call itself threw,
 * e.g. a network error).
 */
export type MintFailure =
  | { readonly reason: Exclude<MintFailureReason, 'upstream-failure'> }
  | { readonly reason: 'upstream-failure'; readonly upstreamStatus?: number };

const MINT_FAILURE_HTTP_STATUS: Record<MintFailureReason, number> = {
  'invalid-request': 400,
  'unsupported-provider': 400,
  'missing-api-key': 500,
  'upstream-failure': 502,
};

/**
 * Suggested HTTP status for a {@link MintFailureReason}, for callers wiring a
 * minter into an HTTP transport. Minters stay transport-agnostic — nothing
 * requires this mapping; a caller with different status-code conventions is
 * free to write its own.
 *
 * @example
 * ```ts
 * return Response.json(
 *   { error: result.error.reason },
 *   { status: mintFailureHttpStatus(result.error.reason) },
 * );
 * ```
 */
export function mintFailureHttpStatus(reason: MintFailureReason): number {
  return MINT_FAILURE_HTTP_STATUS[reason];
}
