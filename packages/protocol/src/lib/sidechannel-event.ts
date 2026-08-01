import { z } from 'zod';
import { SessionIdSchema } from './session.ts';
import { ToolCallIdSchema } from './tool-call-id.ts';

// Shared envelope on every sidechannel event.
const sidechannelBaseShape = {
  sessionId: SessionIdSchema,
  /**
   * Client-clock unix-ms timestamp at emission, stamped by the emitting
   * browser. Subject to clock skew between clients, so it is suitable for
   * intra-session ordering and latency diagnostics only — never for
   * comparisons across clients.
   */
  at: z.number().int().nonnegative(),
};

/**
 * The transcript/event stream the client emits to the consumer's backend for
 * observability (metering, recording, debugging). Intentionally carries **no
 * audio** — only transcripts, tool-call metadata, and timings. This is the
 * exact contract the cloud tier's metering later rides on, so additive-only.
 *
 * `at` on each event is client-clock time and drifts across clients. Any
 * receiver that needs a trustworthy clock for cross-client ordering,
 * metering, or billing must stamp its own receipt time on ingest and use
 * that instead — `at` is diagnostic only.
 */
export const SidechannelEventSchema = z
  .discriminatedUnion('type', [
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
      callId: ToolCallIdSchema,
      argumentsJson: z.string(),
    }),
    z.object({
      ...sidechannelBaseShape,
      type: z.literal('tool_result'),
      callId: ToolCallIdSchema,
      ok: z.boolean(),
      latencyMs: z.number().nonnegative(),
    }),
    z.object({
      ...sidechannelBaseShape,
      type: z.literal('timing'),
      label: z.string(),
      ms: z.number().nonnegative(),
    }),
  ])
  .readonly();

/** A single sidechannel event. See {@link SidechannelEventSchema}. */
export type SidechannelEvent = z.infer<typeof SidechannelEventSchema>;
