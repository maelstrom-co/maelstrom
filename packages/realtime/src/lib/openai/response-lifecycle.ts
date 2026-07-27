/**
 * Tracks whether an OpenAI Realtime `response` is currently active, so at
 * most one `response.create` is ever in flight at a time. OpenAI rejects a
 * `response.create` sent while a prior response hasn't finished
 * (`response.done` / `response.cancelled` not yet observed) with a
 * "conversation already has an active response" error — a single Realtime
 * response can contain more than one tool call (e.g. `update_ui` and
 * `get_ui_state` back to back), and `get_ui_state` answers instantly while
 * `update_ui` waits for render-settle, so a naive one-`response.create`-per-
 * tool-result policy races the still-active first response.
 */
export type ResponseLifecycleState =
  | { readonly status: 'idle' }
  | { readonly status: 'active' }
  | { readonly status: 'active-pending' };

export const INITIAL_RESPONSE_LIFECYCLE_STATE: ResponseLifecycleState = {
  status: 'idle',
};

/**
 * A caller wants to send `response.create`. If no response is active, send
 * it now. Otherwise defer it — at most one deferred request is tracked, since
 * a burst of tool results behind one active response should only produce a
 * single follow-up response, not one per queued result.
 */
export function requestResponseCreate(state: ResponseLifecycleState): {
  readonly next: ResponseLifecycleState;
  readonly sendNow: boolean;
} {
  switch (state.status) {
    case 'idle':
      return { next: { status: 'active' }, sendNow: true };
    case 'active':
    case 'active-pending':
      return { next: { status: 'active-pending' }, sendNow: false };
  }
}

/** A raw `response.created` event was observed on the data channel. */
export function markResponseActive(
  state: ResponseLifecycleState,
): ResponseLifecycleState {
  switch (state.status) {
    case 'idle':
      return { status: 'active' };
    case 'active':
    case 'active-pending':
      return state;
  }
}

/**
 * A raw `response.done` or `response.cancelled` event was observed. If a
 * `response.create` was deferred behind the now-finished response, this
 * flushes it immediately — `next` reflects the state after that flush, so
 * the caller only has to act on `flush`, not re-derive it.
 */
export function markResponseInactive(state: ResponseLifecycleState): {
  readonly next: ResponseLifecycleState;
  readonly flush: boolean;
} {
  switch (state.status) {
    case 'active-pending':
      return { next: { status: 'active' }, flush: true };
    case 'active':
    case 'idle':
      return { next: { status: 'idle' }, flush: false };
  }
}
