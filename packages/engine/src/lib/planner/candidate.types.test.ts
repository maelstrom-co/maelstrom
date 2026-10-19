import { expect, test } from 'bun:test';
import type {
  MaelstromResponse,
  NeedsClarification,
  Result,
} from '@maelstrom-co/protocol';
import { ok } from '@maelstrom-co/protocol';

import type { EngineError } from '../errors.js';
import type {
  EngineDiagnostics,
  PlannerCandidate,
  PlannerOutput,
  ReplylessCandidate,
  ValidatedCandidate,
  ValidatedReplylessCandidate,
} from './candidate.js';
import { pipeline } from './pipeline.js';
import type {
  ClarifyingPlanner,
  Planner,
  PlanningInput,
  Retryable,
  RetryFeedback,
  Stage,
  StageContext,
  ValidateCandidate,
} from './stage.js';
import { withFallback } from './with-fallback.js';
import { withRetry } from './with-retry.js';

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// Compiled by `typecheck` (tsconfig.spec.json); the assertions are the types.
const _strictCandidateReply: Equals<PlannerCandidate['userMessage'], string> =
  true;
const _replylessCandidateReply: Equals<
  ReplylessCandidate['userMessage'],
  string | undefined
> = true;
const _strictValidated: Equals<
  ValidatedCandidate,
  MaelstromResponse & { readonly diagnostics: EngineDiagnostics }
> = true;
const _strictValidatedReply: Equals<ValidatedCandidate['userMessage'], string> =
  true;
const _replylessValidatedReply: Equals<
  ValidatedReplylessCandidate['userMessage'],
  string | undefined
> = true;
const _plannerOutput: Equals<
  PlannerOutput,
  PlannerCandidate | ReplylessCandidate | NeedsClarification
> = true;
const _strictFeedback: Equals<RetryFeedback['previous'], PlannerCandidate> =
  true;
const _strictRetryable: Equals<
  NonNullable<Retryable<PlanningInput>['retry']>['previous'],
  PlannerCandidate
> = true;
const _replylessFeedback: Equals<
  RetryFeedback<ReplylessCandidate>['previous'],
  ReplylessCandidate
> = true;

declare const ctx: StageContext;
declare const strictCandidate: PlannerCandidate;
declare const replylessCandidate: ReplylessCandidate;
declare const clarification: NeedsClarification;

function stageValidateCases(): unknown[] {
  const strictReport = ctx.validate(strictCandidate);
  const strictReportType: Equals<
    typeof strictReport,
    Result<ValidatedCandidate, EngineError>
  > = true;
  const replylessReport = ctx.validate(replylessCandidate);
  const replylessReportType: Equals<
    typeof replylessReport,
    Result<ValidatedReplylessCandidate, EngineError>
  > = true;
  const strictReply: string | undefined = strictReport.ok
    ? strictReport.value.userMessage
    : undefined;
  if (replylessReport.ok) {
    // @ts-expect-error a validated replyless candidate may omit userMessage
    const required: string = replylessReport.value.userMessage;
    void required;
  }
  // @ts-expect-error stages validate layout candidates, not clarifications
  const clarificationReport = ctx.validate(clarification);
  // Validators written for strict candidates only stay assignable.
  const strictOnly: ValidateCandidate = (candidate: PlannerCandidate) =>
    ok({ ...candidate } as never);
  return [
    strictReportType,
    replylessReportType,
    strictReply,
    clarificationReport,
    strictOnly,
  ];
}

declare const strictRetryable: Stage<
  Retryable<PlanningInput>,
  PlannerCandidate
>;
declare const replylessRetryable: Stage<
  Retryable<PlanningInput, ReplylessCandidate>,
  ReplylessCandidate
>;
declare const clarifyingRetryable: Stage<
  Retryable<PlanningInput, ReplylessCandidate>,
  PlannerOutput
>;
declare const strictPlanner: Planner;
declare const clarifyingPlanner: ClarifyingPlanner;
declare const renderStrict: Stage<PlanningInput, PlannerCandidate>;
declare const renderReplyless: Stage<PlanningInput, ReplylessCandidate>;
declare const renderClarifying: Stage<PlanningInput, PlannerOutput>;

function combinatorCases(): unknown[] {
  const retriedStrict = withRetry(strictRetryable, { max: 1 });
  const retriedStrictType: Equals<typeof retriedStrict, Planner> = true;
  const retriedPlanner = withRetry(strictPlanner, { max: 1 });
  const retriedPlannerType: Equals<typeof retriedPlanner, Planner> = true;
  const retriedReplyless = withRetry(replylessRetryable, { max: 1 });
  const retriedReplylessType: Equals<
    typeof retriedReplyless,
    Stage<PlanningInput, ReplylessCandidate>
  > = true;
  const retriedClarifying = withRetry(clarifyingRetryable, { max: 1 });
  const retriedClarifyingType: Equals<
    typeof retriedClarifying,
    ClarifyingPlanner
  > = true;
  const retriedClarifyingPlanner = withRetry(clarifyingPlanner, { max: 1 });
  const retriedClarifyingPlannerType: Equals<
    typeof retriedClarifyingPlanner,
    ClarifyingPlanner
  > = true;
  const strictFeedbackOnly = withRetry(
    // @ts-expect-error a clarifying stage is retried with replyless feedback
    clarifyingRetryable as Stage<Retryable<PlanningInput>, PlannerOutput>,
    { max: 1 },
  );
  const fellBack = withFallback(strictPlanner, strictPlanner);
  const fellBackType: Equals<typeof fellBack, Planner> = true;
  const piped = pipeline(renderStrict);
  const pipedType: Equals<typeof piped, Planner> = true;
  const pipedReplyless = pipeline(renderReplyless);
  const pipedReplylessType: Equals<
    typeof pipedReplyless,
    Stage<PlanningInput, ReplylessCandidate>
  > = true;
  const pipedClarifying = pipeline(renderClarifying);
  const pipedClarifyingType: Equals<typeof pipedClarifying, ClarifyingPlanner> =
    true;
  // @ts-expect-error a replyless pipeline is not a reply-only Planner
  const pipedNarrowed: Planner = pipeline(renderReplyless);
  return [
    retriedStrictType,
    retriedPlannerType,
    retriedReplylessType,
    retriedClarifyingType,
    retriedClarifyingPlannerType,
    strictFeedbackOnly,
    fellBackType,
    pipedType,
    pipedReplylessType,
    pipedClarifyingType,
    pipedNarrowed,
  ];
}

test('strict and replyless planner types stay distinct', () => {
  expect([
    _strictCandidateReply,
    _replylessCandidateReply,
    _strictValidated,
    _strictValidatedReply,
    _replylessValidatedReply,
    _plannerOutput,
    _strictFeedback,
    _strictRetryable,
    _replylessFeedback,
  ]).toEqual([true, true, true, true, true, true, true, true, true]);
  expect(typeof stageValidateCases).toBe('function');
  expect(typeof combinatorCases).toBe('function');
});
