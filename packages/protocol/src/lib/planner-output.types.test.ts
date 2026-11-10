import { expect, test } from 'bun:test';

import type { NeedsClarification } from './needs-clarification.js';
import type {
  ChartRequest,
  GridModelOutput,
  GridResponse,
  GridResponseWithoutReply,
  PlannerOutputFor,
  TilingModelOutput,
  TilingResponse,
  TilingResponseWithoutReply,
} from './request.js';

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

type ReplyBearing = GridResponse | TilingResponse;
type Replyless =
  | GridResponseWithoutReply
  | TilingResponseWithoutReply
  | NeedsClarification;

type WithoutFlag = Omit<ChartRequest, 'skipReply'>;
type FlagFalse = ChartRequest & { readonly skipReply: false };
type FlagTrue = ChartRequest & { readonly skipReply: true };

// Compiled by `typecheck` (tsconfig.spec.json); the assertions are the types.
const _absent: Equals<PlannerOutputFor<WithoutFlag>, ReplyBearing> = true;
const _false: Equals<PlannerOutputFor<FlagFalse>, ReplyBearing> = true;
const _true: Equals<PlannerOutputFor<FlagTrue>, Replyless> = true;
const _unknown: Equals<PlannerOutputFor<ChartRequest>, Replyless> = true;
const _distributes: Equals<
  PlannerOutputFor<FlagFalse | FlagTrue>,
  ReplyBearing | Replyless
> = true;

const _replyBearingTag: Equals<PlannerOutputFor<WithoutFlag>['type'], 'plan'> =
  true;
const _replylessTag: Equals<
  PlannerOutputFor<FlagTrue>['type'],
  'plan' | 'needs_clarification'
> = true;
const _modelOutputUntagged: Equals<
  'type' extends keyof GridModelOutput | keyof TilingModelOutput ? 1 : 0,
  0
> = true;
const _taggedExtendsModel: Equals<
  Omit<GridResponse, 'type'>,
  GridModelOutput
> = true;
const _clarificationLayoutByMode: [
  Equals<
    NonNullable<NeedsClarification<'grid'>['layout']>,
    GridResponse['layout']
  >,
  Equals<
    NonNullable<NeedsClarification<'tiling'>['layout']>,
    TilingResponse['layout']
  >,
  Equals<
    NonNullable<NeedsClarification['layout']>,
    GridResponse['layout'] | TilingResponse['layout']
  >,
] = [true, true, true];

function guarantees(): void {
  const replyBearing = {} as PlannerOutputFor<FlagFalse>;
  const message: string = replyBearing.userMessage;

  const replyless = {} as PlannerOutputFor<FlagTrue>;
  if (replyless.type === 'needs_clarification') {
    const question: string = replyless.question;
    void question;
  } else {
    // @ts-expect-error a replyless plan may omit userMessage
    const required: string = replyless.userMessage;
    void required;
  }

  // @ts-expect-error a reply-bearing output is never a clarification
  const clarification: NeedsClarification = replyBearing;

  const modelOutput = {} as GridModelOutput;
  // @ts-expect-error model output lacks the type a plan result requires
  const untagged: GridResponse = modelOutput;
  const stamped: GridResponse = { ...modelOutput, type: 'plan' };

  const gridClarification = {} as NeedsClarification<'grid'>;
  // @ts-expect-error a grid clarification never carries a tiling layout
  const tilingLayout: TilingResponse['layout'] | undefined =
    gridClarification.layout;

  void [message, clarification, untagged, stamped, tilingLayout];
}

test('PlannerOutputFor follows the request skipReply flag', () => {
  expect([
    _absent,
    _false,
    _true,
    _unknown,
    _distributes,
    _replyBearingTag,
    _replylessTag,
    _modelOutputUntagged,
    _taggedExtendsModel,
    ..._clarificationLayoutByMode,
  ]).toEqual(Array.from({ length: 12 }, () => true));
  expect(typeof guarantees).toBe('function');
});
