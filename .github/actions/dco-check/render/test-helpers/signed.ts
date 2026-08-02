import { commit } from '../../fixtures/commit.ts';
import type { Verdict } from '../../policy/verdict.ts';

export const signed: Verdict = { commit: commit(), state: 'signed' };
