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
 * {@link TOOL_SUMMARY_MAX_LENGTH} characters. A failure summary never carries a
 * raw error message, except the message of a {@link ToolError}.
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
 * validates the output and summarizes it. Never throws for a tool failure:
 * every outcome is a {@link ToolCallResult}.
 */
export async function executeToolCall(
  entry: ToolRegistryEntry,
  rawArgs: unknown,
  identity: ToolCallIdentity,
  signal: AbortSignal,
): Promise<ToolCallResult> {
  const name = entry.tool.name;
  const parsedInput = entry.tool.input.safeParse(rawArgs);
  if (!parsedInput.success) {
    return failure('invalid_arguments', `${name} received invalid arguments`);
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
    return failure('tool_failed', toolFailureSummary(name, error));
  }

  const parsedOutput = entry.tool.output.safeParse(rawOutput);
  if (!parsedOutput.success) {
    return failure('invalid_output', `${name} returned an invalid result`);
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
 * and a summary capped at {@link TOOL_SUMMARY_MAX_LENGTH}.
 */
export function validateToolResultEnvelope(
  entry: ToolRegistryEntry,
  value: unknown,
): ToolResultEnvelopeValidation {
  const envelope = ToolResultEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { valid: false, reason: 'not a tool result envelope' };
  }
  if (!envelope.data.ok) {
    return {
      valid: true,
      result: failure(envelope.data.code, envelope.data.summary),
    };
  }
  const output = entry.tool.output.safeParse(envelope.data.value);
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

const ToolResultEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.unknown(),
    summary: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(TOOL_CALL_FAILURE_CODES),
    summary: z.string().min(1),
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
  if (error instanceof ToolError && error.message.length > 0) {
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
  return typeof summary === 'string' && summary.length > 0
    ? capSummary(summary)
    : `${entry.tool.name} succeeded`;
}

function failure(code: ToolCallFailureCode, summary: string): ToolCallResult {
  return { ok: false, code, summary: capSummary(summary) };
}

function capSummary(summary: string): string {
  return summary.length > TOOL_SUMMARY_MAX_LENGTH
    ? `${summary.slice(0, TOOL_SUMMARY_MAX_LENGTH - 1)}…`
    : summary;
}
