import { expect, test } from 'bun:test';

import type { NeedsClarification } from './needs-clarification.js';
import type {
  ChartRequest,
  GridResponse,
  GridResponseWithoutReply,
  PlannerOutputFor,
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

function guarantees(): void {
  const replyBearing = {} as PlannerOutputFor<FlagFalse>;
  const message: string = replyBearing.userMessage;

  const replyless = {} as PlannerOutputFor<FlagTrue>;
  if ('type' in replyless) {
    const question: string = replyless.question;
    void question;
  } else {
    // @ts-expect-error a replyless candidate may omit userMessage
    const required: string = replyless.userMessage;
    void required;
  }

  // @ts-expect-error a reply-bearing output is never a clarification
  const clarification: NeedsClarification = replyBearing;
  void [message, clarification];
}

test('PlannerOutputFor follows the request skipReply flag', () => {
  expect([_absent, _false, _true, _unknown, _distributes]).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(typeof guarantees).toBe('function');
});
