import type { Result } from '@maelstrom-co/protocol';

/**
 * Result returned by a vessel action handler.
 *
 * Domain alias over the protocol's generic `Result` that tightens the
 * error channel to `Error`. Vessel author handlers signal success with
 * `ok(value)` and failure with `err(new Error(...))` from
 * `@maelstrom-co/protocol`.
 *
 * The success value belongs to the application. The SDK never reads it and
 * carries it through untouched as the Action's `value` in the requesting
 * operation's outcome. Keep it small plain data. Typed access by Action name
 * is planned. Return `ok(undefined)` when there is nothing to carry back.
 *
 * @example
 * ```typescript
 * import { ok, err } from '@maelstrom-co/protocol';
 * import type { ActionResult } from '@maelstrom-co/client';
 *
 * const handler = async (params: { orderId: string }): Promise<ActionResult> => {
 *   if (!params.orderId) return err(new Error('orderId required'));
 *   return ok({ orderId: params.orderId });
 * };
 * ```
 */
export type ActionResult = Result<unknown, Error>;
