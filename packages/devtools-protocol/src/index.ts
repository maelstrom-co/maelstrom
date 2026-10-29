import { z } from 'zod';

/** Maximum UTF-8 bytes in one browser bridge envelope. */
export const MAX_BRIDGE_BYTES = 262_144;
/** Opaque collector connection handle; renewed for every pairing. */
export const TargetIdSchema = z
  .uuid()
  .brand<'DevtoolsTargetId'>()
  .describe(
    'Collector handle returned by list_targets. A reconnect creates a new handle.',
  );
/** A collector connection handle created by the local server. */
export type DevtoolsTargetId = z.infer<typeof TargetIdSchema>;
/** First browser message, authenticated before the target becomes visible. */
export const PairingSchema = z.strictObject({
  type: z.literal('pair'),
  version: z.literal(1),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Server acknowledgment for one authenticated connection. */
export const PairedSchema = z.strictObject({
  type: z.literal('paired'),
  targetId: TargetIdSchema,
});
/** Visible target metadata without credentials or application state. */
export const TargetSchema = z.strictObject({
  id: TargetIdSchema,
  origin: z.string().max(2048),
});
/** Result of listing the process's paired collectors. */
export const TargetsSchema = z.strictObject({
  targets: z.array(TargetSchema).max(8),
});
/** Opaque app lifetime handle, scoped to one browser bridge connection. */
export const AppIdSchema = z
  .uuid()
  .brand<'DevtoolsAppId'>()
  .describe(
    'App lifetime handle returned by list_apps. Do not substitute a reported metadata identity.',
  );
/** A reported identity after the application's redaction policy. */
export const EvidenceIdSchema = z.string().min(1).max(1024);
/** App lifetime handle without a domain identity guarantee. */
export type DevtoolsAppId = z.infer<typeof AppIdSchema>;
/** Input for listing app lifetimes on one collector. */
export const ListAppsSchema = z.strictObject({ targetId: TargetIdSchema });
/** Editable criteria shared with the DevTools event-query semantics. */
export const EventCriteriaSchema = z
  .strictObject({
    query: z.string().max(256).optional(),
    family: z
      .enum(['voice', 'engine', 'actions', 'client', 'other'])
      .optional(),
    kind: z.string().min(1).max(256).optional(),
    outcome: z
      .enum([
        'succeeded',
        'started',
        'succeeded_with_issues',
        'failed',
        'cancelled',
        'discarded',
        'skipped',
        'unknown',
        'abandoned',
        'unreported',
      ])
      .optional(),
    issueCategory: z
      .enum([
        'all',
        'transport',
        'validation',
        'timeout',
        'readiness',
        'application',
        'provider',
        'unknown',
        'unreported',
      ])
      .optional(),
    requestKey: z.string().max(4096).optional(),
    voiceKey: z.string().max(4096).optional(),
    from: z.number().min(0).max(8.64e15).optional(),
    until: z.number().min(0).max(8.64e15).optional(),
  })
  .refine(
    (value) =>
      value.from === undefined ||
      value.until === undefined ||
      value.from <= value.until,
    'Invalid time range.',
  );
/** Input for one app's live metadata query. */
export const QueryEventsSchema = z.strictObject({
  targetId: TargetIdSchema,
  appId: AppIdSchema,
  view: z
    .enum(['recent', 'requests', 'connections'])
    .default('recent')
    .describe(
      'Retained live collection. Recent activity, request history, and terminal connection summaries have separate bounds.',
    ),
  criteria: EventCriteriaSchema.default({}),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .max(80)
    .optional()
    .describe(
      'Next-page cursor. Repeat all original arguments, including view, criteria, and limit.',
    ),
});
/** Input for a qualified request's retained metadata and reported timings. */
export const GetRequestSchema = QueryEventsSchema.omit({
  view: true,
  criteria: true,
}).extend({ requestId: EvidenceIdSchema });
/** Read operations accepted by the browser bridge. */
export const ReadCommandSchema = z.discriminatedUnion('operation', [
  ListAppsSchema.extend({ operation: z.literal('list_apps') }),
  QueryEventsSchema.extend({ operation: z.literal('query_events') }),
  GetRequestSchema.extend({ operation: z.literal('get_request') }),
]);
/** Correlated read request from the authenticated local process. */
export const ReadRequestSchema = z.strictObject({
  type: z.literal('read'),
  id: z.uuid(),
  command: ReadCommandSchema,
});
/** Machine-readable failures; evidence cannot supply arbitrary error text. */
export const ReadErrorSchema = z.enum([
  'target_unavailable',
  'app_unavailable',
  'request_unavailable',
  'invalid_request',
  'limit_exceeded',
  'timeout',
  'evidence_unavailable',
  'stale_cursor',
  'cancelled',
]);
/** Bounded app list without application definitions or live state. */
export const AppsSchema = z.strictObject({
  kind: z.literal('apps'),
  apps: z
    .array(
      z.strictObject({
        id: AppIdSchema,
        active: z.boolean(),
        identity: z.enum(['reported', 'unavailable', 'ambiguous']),
        reportedId: EvidenceIdSchema.optional(),
      }),
    )
    .max(100),
  omitted: z.number().int().nonnegative(),
});
/** An already-redacted observation without raw envelopes or captured content. */
export const MetadataEventSchema = z.strictObject({
  kind: z.string().max(1024),
  appId: AppIdSchema,
  requestId: z.string().max(1024).optional(),
  at: z.number().finite().optional(),
  metadata: z.record(z.string(), z.unknown()),
});
/** Reported producer duration or the explicit reason it is unavailable. */
export const TimingEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reported'),
    durationMs: z.number().nonnegative().finite(),
  }),
  z.strictObject({
    kind: z.literal('unreported'),
    reason: z.enum([
      'missing',
      'redacted',
      'truncated',
      'unreadable',
      'source-unavailable',
      'push',
      'ambiguous',
    ]),
  }),
]);
/** Shared DevTools request interpretation with independent producer clocks. */
export const RequestSummarySchema = z.strictObject({
  requestId: EvidenceIdSchema,
  outcome: z.enum([
    'awaiting',
    'received',
    'applied',
    'applied-with-issues',
    'failed',
    'cancelled',
    'discarded',
    'abandoned',
    'unknown',
    'ambiguous',
  ]),
  roundTrip: TimingEvidenceSchema,
  application: TimingEvidenceSchema,
});
/** Bounded event query with explicit source and loss scope. */
export const EventsSchema = z.strictObject({
  kind: z.literal('events'),
  view: QueryEventsSchema.shape.view,
  observedAt: z.number(),
  events: z.array(MetadataEventSchema).max(100),
  request: RequestSummarySchema.optional(),
  total: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  hidden: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  cursor: z.string().max(80).optional(),
  viewerOmitted: z.number().int().nonnegative(),
  losses: z.strictObject({
    scope: z.literal('all_apps'),
    recent: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
    connections: z.null(),
  }),
});
/** Frozen metadata query page. Loss counters cover all apps in the collector. */
export type EventsPage = z.infer<typeof EventsSchema>;
/** Typed result returned across the browser bridge and MCP. */
export const ReadResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    data: z.discriminatedUnion('kind', [AppsSchema, EventsSchema]),
  }),
  z.strictObject({ ok: z.literal(false), error: ReadErrorSchema }),
]);
/** Result envelope correlated to one pending read. */
export const ReadResponseSchema = z.strictObject({
  type: z.literal('result'),
  id: z.uuid(),
  result: ReadResultSchema,
});
/** Validated read operation accepted by a paired collector. */
export type ReadCommand = z.infer<typeof ReadCommandSchema>;
/** A bounded successful read or a fixed failure code. */
export type ReadResult = z.infer<typeof ReadResultSchema>;

/** Validates a local app origin without accepting paths or credentials. */
export function localAppOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.origin !== value
  )
    throw new Error('Use an exact HTTP loopback app origin.');
  return url.origin;
}

/** Validates the fixed loopback endpoint before a credential can be sent. */
export function localBridgeEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/devtools' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use the local DevTools WebSocket endpoint.');
  return url.href;
}
