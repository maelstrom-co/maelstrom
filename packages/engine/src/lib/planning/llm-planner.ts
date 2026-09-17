import {
  err,
  GridResponseSchema,
  isErr,
  ok,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import type { Logger } from '../logger.js';
import { consoleLogger } from '../logger.js';
import { callLLM } from '../pipeline/call-llm.js';
import type { PromptOptions } from '../prompt/prompt-builder.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
} from '../prompt/prompt-builder.js';
import type {
  Planner,
  PlannerCandidate,
  PlannerFailure,
  PlannerInvocation,
} from './contracts.js';

/** Provider-specific construction options for the conventional LLM planner. */
export interface LlmPlannerOptions {
  /** TanStack AI adapter that performs each logical `chat()` invocation. */
  readonly adapter: AnyTextAdapter;
  /** Prompt customization retained from the adapter compatibility path. */
  readonly prompt?: PromptOptions;
  /** Provider model options forwarded unchanged to `chat()`. */
  readonly modelOptions?: Record<string, unknown>;
  /** Logger used by prompt construction. Defaults to {@link consoleLogger}. */
  readonly logger?: Logger;
}

/**
 * Creates the conventional LLM planner.
 *
 * Each invocation prepares its prompt before it claims exactly one logical
 * call and starts exactly one TanStack `chat()` operation.
 * System prompts for both layout modes are built during construction. User-prompt
 * customization runs during invocation; its failures use the Planner failure Result
 * channel before any provider call is claimed.
 *
 * @throws If a system-section customizer function targets a non-default section
 * or a system customizer callback throws. These synchronous construction errors
 * occur before a Planner exists and do not pass through `invoke`'s Result channel.
 */
export function createLlmPlanner(options: LlmPlannerOptions): Planner {
  const promptOptions = options.prompt ?? {};
  const logger = options.logger ?? consoleLogger;
  const systemPrompts = {
    grid: buildSystemPrompt('grid', promptOptions),
    tiling: buildSystemPrompt('tiling', promptOptions),
  };
  const initialPrompts = new WeakMap<object, string>();

  return Object.freeze({
    id: 'llm',
    supportedLayoutModes: Object.freeze(['grid', 'tiling'] as const),
    async invoke(invocation: PlannerInvocation) {
      if (invocation.context.signal.aborted)
        return err(abortFailure(invocation));
      let originalPrompt = initialPrompts.get(invocation.input);
      try {
        if (originalPrompt === undefined) {
          originalPrompt = buildUserPrompt(
            invocation.input.request,
            promptOptions,
            logger,
          );
          initialPrompts.set(invocation.input, originalPrompt);
        }
      } catch (cause) {
        return err<PlannerFailure>({
          kind: 'validation_error',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      }
      if (invocation.context.signal.aborted)
        return err(abortFailure(invocation));
      const claim = invocation.context.calls.claim({
        plannerId: 'llm',
        stage: invocation.phase.kind,
      });
      if (isErr(claim)) {
        return err<PlannerFailure>({
          kind: 'budget_exhausted',
          message: 'planning call budget exhausted',
        });
      }

      const mode = invocation.input.request.context.layoutMode;
      const result = await callLLM(
        options.adapter,
        systemPrompts[mode],
        invocation.phase.kind === 'initial'
          ? originalPrompt
          : repairPrompt(originalPrompt, invocation),
        mode === 'grid' ? GridResponseSchema : TilingResponseSchema,
        invocation.input.history.conversation,
        invocation.context.signal,
        options.modelOptions,
      );
      if (isErr(result)) {
        switch (result.error._tag) {
          case 'CancellationError':
            return err(abortFailure(invocation));
          case 'InvalidProviderResponseError':
            return err({
              kind: 'invalid_provider_response' as const,
              message: result.error.message,
              cause: result.error.cause,
            });
          case 'ProviderError':
            return err({
              kind: 'provider_error' as const,
              message: result.error.message,
              cause: result.error.cause,
            });
          default:
            return err({
              kind: 'provider_error' as const,
              message: result.error.message,
              cause: result.error,
            });
        }
      }
      return ok({
        kind: 'candidate' as const,
        candidate: toCandidate(result.value),
      });
    },
  });
}

function toCandidate(response: {
  readonly userMessage: string;
  readonly rationale: string;
  readonly layout: unknown;
  readonly executionPlan: readonly {
    readonly instanceId: unknown;
    readonly action: unknown;
    readonly paramsJson?: string;
  }[];
}): PlannerCandidate {
  return {
    requiresPresentation: true,
    userMessage: response.userMessage,
    rationale: response.rationale,
    layout: response.layout,
    executionPlan: response.executionPlan.map((action) => ({
      instanceId: action.instanceId,
      action: action.action,
      ...(action.paramsJson !== undefined && {
        // Preserve provider JSON so finalization applies the legacy per-action
        // byte, depth, and work limits without a candidate-wide normalization.
        params: action.paramsJson,
      }),
    })),
  };
}

function repairPrompt(original: string, invocation: PlannerInvocation): string {
  if (invocation.phase.kind !== 'repair') return original;
  const details = invocation.phase.report.issues
    .map((entry) => {
      const location = entry.location;
      const targets = [
        location?.path !== undefined
          ? `path=${location.path.join('.')}`
          : undefined,
        location?.actionIndex !== undefined
          ? `actionIndex=${location.actionIndex}`
          : undefined,
        location?.instanceId !== undefined
          ? `instanceId=${location.instanceId}`
          : undefined,
        location?.action !== undefined
          ? `action=${location.action}`
          : undefined,
        location?.parameter !== undefined
          ? `parameter=${location.parameter}`
          : undefined,
        location?.parameterIssueKinds !== undefined
          ? `parameterIssues=${location.parameterIssueKinds.join(',')}`
          : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join(', ');
      return `- ${entry.kind}/${entry.code}${targets ? ` (${targets})` : ''}: ${entry.message}`;
    })
    .join('\n');
  const omitted = invocation.phase.report.omittedIssueCount;
  return `The previous response had issues. Please re-issue the response addressing:\n\n${details}${omitted > 0 ? `\n- ${omitted} additional issues omitted` : ''}\n\nOriginal request: ${original}`;
}

function abortFailure(invocation: PlannerInvocation): PlannerFailure {
  const timedOut =
    invocation.context.deadlineAt !== undefined &&
    Date.now() >= invocation.context.deadlineAt;
  return timedOut
    ? { kind: 'timeout', message: 'planning operation timed out' }
    : {
        kind: 'cancelled',
        message: 'planning operation cancelled',
        cause: invocation.context.signal.reason,
      };
}
