import { z } from 'zod';
import { MessageIdSchema } from './message.ts';
import { SessionIdSchema } from './session.ts';

/** Scalar metadata retained without recording application content. */
export type DiagnosticMetadata = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

/** One diagnostic observation. Durations use the emitting process's clock. */
export interface DiagnosticEvent {
  /** Unique event identity within a capture. */
  readonly id: string;
  /** Namespaced event name, such as `client.request.started`. */
  readonly kind: string;
  /** Wall-clock emission time; clocks in different processes can disagree. */
  readonly at: number;
  /** Session whose work produced this event. */
  readonly sessionId: string;
  /** Originating request when the producer can prove the association. */
  readonly requestId?: string;
  /** Metadata that excludes transcripts, prompts, arguments, and credentials. */
  readonly metadata: DiagnosticMetadata;
  /** Explicitly recorded application content, after producer-side redaction. */
  readonly content?: unknown;
}

/** Validates diagnostic frames without accepting executable content. */
export const DiagnosticEventSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.string().min(1).max(128),
  at: z.number().finite().nonnegative(),
  sessionId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  metadata: z
    .record(
      z.string().max(128),
      z.union([
        z.string().max(16384),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    )
    .refine((value) => Object.keys(value).length <= 64),
  content: z.unknown().optional(),
});

/** Subscription sent over an existing Engine connection. Hosts must opt in. */
export const DiagnosticSubscriptionSchema = z.object({
  type: z.literal('client.diagnostics.subscribe'),
  id: MessageIdSchema,
  sessionId: SessionIdSchema,
  enabled: z.boolean(),
  includeContent: z.boolean(),
});

/** Subscription configuration on the wire. */
export type DiagnosticSubscription = z.infer<
  typeof DiagnosticSubscriptionSchema
>;

/** Diagnostic event sent separately from normal Engine responses. */
export const DiagnosticMessageSchema = z.object({
  type: z.literal('engine.diagnostics.event'),
  event: DiagnosticEventSchema,
});

/** Validated diagnostic server frame. */
export type DiagnosticMessage = z.infer<typeof DiagnosticMessageSchema>;
