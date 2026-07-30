import type { Verdict } from './verdict.ts';

export type Violation = Extract<Verdict, { state: 'violation' }>;
