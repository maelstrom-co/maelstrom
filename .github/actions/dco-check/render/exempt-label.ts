import type { Verdict } from '../policy/verdict.ts';

// The one place an exempt reason is turned into prose. `satisfies` is what makes
// it load-bearing: a reason added to Verdict fails to compile until it has a
// label here, instead of being mislabelled as the last arm of a ternary. Key
// order is the order the categories are listed in on a pass.
export const EXEMPT_LABEL = {
  'merge-commit': 'merge commit',
  'bot-author': 'bot author',
} as const satisfies Record<
  Extract<Verdict, { state: 'exempt' }>['reason'],
  string
>;
