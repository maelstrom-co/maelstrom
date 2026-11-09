import { z } from 'zod';

import { assertNever } from '../assert-never.js';
import { runServerTool, type ToolCallIdentity } from './server-tool-runner.js';
import { ToolError } from './server-tool.js';
import type { ToolRegistryEntry } from './tool-registry.js';

/** Maximum length of a tool result summary, in UTF-16 code units. */
export const TOOL_SUMMARY_MAX_LENGTH = 200;

/** Why a tool call produced no usable value. */
export type ToolCallFailureCode = (typeof TOOL_CALL_FAILURE_CODES)[number];

/**
 * Outcome of one tool call. `summary` is user-safe and at most
 * {@link TOOL_SUMMARY_MAX_LENGTH} characters.
 */
export type ToolCallResult =
  | {
      readonly ok: true;
      /** The tool output, validated against its output schema. */
      readonly value: unknown;
      readonly summary: string;
    }
  | {
      readonly ok: false;
      readonly code: ToolCallFailureCode;
      readonly summary: string;
      /**
       * The thrown value or schema error behind the failure, when there is one.
       * Server-side only, for logging. Never send it to the model, the wire or
       * a transcript.
       */
      readonly cause?: unknown;
    };

/** Whether a substituted result envelope is acceptable, with the normalized result when it is. */
export type ToolResultEnvelopeValidation =
  | { readonly valid: true; readonly result: ToolCallResult }
  | {
      readonly valid: false;
      /** A fixed, user-safe description of why the envelope was rejected. */
      readonly reason: string;
    };

/**
 * Executes one model-requested tool call through the runner for the tool's locus.
 *
 * Parses `rawArgs` against the input schema, refuses an already aborted
 * `signal`, runs the tool with `identity` and `signal` as its context,
 * validates the output and summarizes it. Never throws: every outcome,
 * including a schema that throws or needs async parsing, is a
 * {@link ToolCallResult}. A failure summary never carries a raw error message,
 * except the message of a {@link ToolError}. The original error goes only to
 * `cause`.
 */
export async function executeToolCall(
  entry: ToolRegistryEntry,
  rawArgs: unknown,
  identity: ToolCallIdentity,
  signal: AbortSignal,
): Promise<ToolCallResult> {
  const name = entry.tool.name;
  const parsedInput = safeParseNeverThrowing(entry.tool.input, rawArgs);
  if (!parsedInput.success) {
    return failure(
      'invalid_arguments',
      `${name} received invalid arguments`,
      parsedInput.error,
    );
  }
  if (signal.aborted) {
    return failure('cancelled', `${name} was cancelled`);
  }

  let rawOutput: unknown;
  try {
    rawOutput = await dispatchByLocus(
      entry,
      parsedInput.data,
      identity,
      signal,
    );
  } catch (error) {
    return failure('tool_failed', toolFailureSummary(name, error), error);
  }

  const parsedOutput = safeParseNeverThrowing(entry.tool.output, rawOutput);
  if (!parsedOutput.success) {
    return failure(
      'invalid_output',
      `${name} returned an invalid result`,
      parsedOutput.error,
    );
  }
  return {
    ok: true,
    value: parsedOutput.data,
    summary: safeSummary(entry, parsedOutput.data),
  };
}

/**
 * The tool result as the model sees it: the full value on success,
 * `{ ok: false, error }` with the sanitized summary on failure.
 */
export function toModelToolPayload(result: ToolCallResult): unknown {
  return result.ok ? result.value : { ok: false, error: result.summary };
}

/**
 * Validates a result envelope substituted for a real tool run, for example by
 * middleware that skips or replaces a call. A success envelope's `value` must
 * pass the tool's output schema. The accepted result carries the parsed value
 * and a summary capped at {@link TOOL_SUMMARY_MAX_LENGTH}. The envelope's
 * summary is trusted as given and only capped, never sanitized or rebuilt with
 * the tool's `summarize`. Never throws.
 */
export function validateToolResultEnvelope(
  entry: ToolRegistryEntry,
  value: unknown,
): ToolResultEnvelopeValidation {
  const envelope = safeParseNeverThrowing(ToolResultEnvelopeSchema, value);
  if (!envelope.success) {
    return { valid: false, reason: 'not a tool result envelope' };
  }
  if (!envelope.data.ok) {
    return {
      valid: true,
      result: failure(envelope.data.code, envelope.data.summary),
    };
  }
  const output = safeParseNeverThrowing(entry.tool.output, envelope.data.value);
  if (!output.success) {
    return {
      valid: false,
      reason: `value does not match the ${entry.tool.name} output schema`,
    };
  }
  return {
    valid: true,
    result: {
      ok: true,
      value: output.data,
      summary: capSummary(envelope.data.summary),
    },
  };
}

const TOOL_CALL_FAILURE_CODES = [
  'invalid_arguments',
  'cancelled',
  'invalid_output',
  'tool_failed',
] as const;

const NonBlankSummarySchema = z
  .string()
  .min(1)
  .refine(isNonBlank, { message: 'summary must not be whitespace-only' });

const ToolResultEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.unknown(),
    summary: NonBlankSummarySchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(TOOL_CALL_FAILURE_CODES),
    summary: NonBlankSummarySchema,
  }),
]);

function dispatchByLocus(
  entry: ToolRegistryEntry,
  input: unknown,
  identity: ToolCallIdentity,
  signal: AbortSignal,
): Promise<unknown> {
  switch (entry.locus) {
    case 'server':
      return runServerTool(entry, input, identity, signal);
    default:
      return assertNever(entry.locus, 'Unknown tool locus');
  }
}

function toolFailureSummary(name: string, error: unknown): string {
  if (error instanceof ToolError && isNonBlank(error.message)) {
    return error.message;
  }
  return `${name} failed`;
}

function safeSummary(entry: ToolRegistryEntry, output: unknown): string {
  let summary: unknown;
  try {
    summary = entry.summarize(output);
  } catch {
    summary = undefined;
  }
  return typeof summary === 'string' && isNonBlank(summary)
    ? capSummary(summary)
    : `${entry.tool.name} succeeded`;
}

function safeParseNeverThrowing<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
): { success: true; data: Output } | { success: false; error: unknown } {
  try {
    return schema.safeParse(value);
  } catch (error) {
    return { success: false, error };
  }
}

function failure(
  code: ToolCallFailureCode,
  summary: string,
  cause?: unknown,
): ToolCallResult {
  const capped = capSummary(summary);
  return cause === undefined
    ? { ok: false, code, summary: capped }
    : { ok: false, code, summary: capped, cause };
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function capSummary(summary: string): string {
  if (summary.length <= TOOL_SUMMARY_MAX_LENGTH) {
    return summary;
  }
  let end = TOOL_SUMMARY_MAX_LENGTH - 1;
  if (isHighSurrogate(summary.charCodeAt(end - 1))) {
    end -= 1;
  }
  return `${summary.slice(0, end)}…`;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}
