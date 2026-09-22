import type { PlanningInput, Stage } from '@maelstrom-co/engine';

import type { Ask } from '../typesafe-client.js';
import { makeContext, plain } from './fixtures.js';
import { type Script, scriptedAsk } from './scripted-fetch.js';

/**
 * Runs a POC stage and its stage-library counterpart on the same input, each
 * with its own client answering from the same script.
 */
export async function runPair<
  In,
  Next extends (ask: Ask) => Stage<In, unknown>,
>(
  poc: (ask: Ask) => Stage<In, unknown>,
  next: Next,
  input: In,
  origin: PlanningInput,
  script: Script,
) {
  const a = scriptedAsk(script);
  const b = scriptedAsk(script);
  const pocResult = await poc(a.ask)(input, makeContext(origin));
  const nextResult = (await next(b.ask)(input, makeContext(origin))) as Awaited<
    ReturnType<ReturnType<Next>>
  >;
  return {
    poc: { result: plain(pocResult), calls: a.calls },
    next: { result: nextResult, plain: plain(nextResult), calls: b.calls },
  };
}
