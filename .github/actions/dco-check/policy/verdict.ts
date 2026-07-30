import type { CommitData } from './commit-data.ts';

export type Verdict =
  | { commit: CommitData; state: 'signed' }
  | {
      commit: CommitData;
      state: 'exempt';
      reason: 'merge-commit' | 'bot-author';
    }
  | { commit: CommitData; state: 'violation'; reason: 'missing-sign-off' }
  | {
      commit: CommitData;
      state: 'violation';
      reason: 'email-mismatch';
      signedOffAs: string[];
    };
