import { z } from 'zod';
import { SessionIdSchema } from './session.js';

// Shared envelope on every sidechannel event. `at` is client unix-ms.
const sidechannelBaseShape = {
  sessionId: SessionIdSchema,
  at: z.number().int().nonnegative(),
};

/**
 * The transcript/event stream the client emits to the consumer's backend for
 * observability (metering, recording, debugging). Intentionally carries **no
 * audio** — only transcripts, tool-call metadata, and timings. This is the
 * exact contract the cloud tier's metering later rides on, so additive-only.
 */
export const SidechannelEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...sidechannelBaseShape,
    type: z.literal('transcript'),
    role: z.enum(['user', 'assistant']),
    text: z.string(),
    final: z.boolean(),
  }),
  z.object({
    ...sidechannelBaseShape,
    type: z.literal('tool_call'),
    name: z.string(),
    callId: z.string(),
    argumentsJson: z.string(),
  }),
  z.object({
    ...sidechannelBaseShape,
    type: z.literal('tool_result'),
    callId: z.string(),
    ok: z.boolean(),
    latencyMs: z.number().nonnegative(),
  }),
  z.object({
    ...sidechannelBaseShape,
    type: z.literal('timing'),
    label: z.string(),
    ms: z.number().nonnegative(),
  }),
]);

/** A single sidechannel event. See {@link SidechannelEventSchema}. */
export type SidechannelEvent = z.infer<typeof SidechannelEventSchema>;
