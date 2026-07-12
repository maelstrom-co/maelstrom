import { z } from 'zod';

import type { Brand } from './brand.js';

/**
 * Absolute Unix-epoch timestamp, in seconds. Branding this separately from
 * plain `number` prevents mixing it up with millisecond timestamps (e.g.
 * `Date.now()`) — a bare `Date.now() > expiresAt` comparison would silently
 * compare the wrong units.
 */
export type UnixSeconds = Brand<number, 'UnixSeconds'>;

/**
 * Wire-format Zod parser for {@link UnixSeconds}. Carries the `UnixSeconds`
 * brand on `z.infer` output so consumer schemas that reference it stay
 * branded end-to-end.
 */
export const UnixSecondsSchema = z
  .number()
  .int()
  .positive()
  .transform((n) => n as UnixSeconds);
