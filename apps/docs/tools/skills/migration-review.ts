import { createHash } from 'node:crypto';

export type ReviewSubmission = { sourceHash: string };
export type ReviewOutcome = {
  status: 'pending' | 'approved' | 'rejected' | 'invalid' | 'stale';
  reviewHash: string | null;
};

export function migrationReview(
  text: string | undefined,
  seal: string,
  submissions: { baseline: ReviewSubmission; treatment: ReviewSubmission },
): ReviewOutcome {
  if (text === undefined) return { status: 'pending', reviewHash: null };
  if (Buffer.byteLength(text) > 16_384)
    return { status: 'invalid', reviewHash: null };
  try {
    const review = JSON.parse(text);
    const hash = createHash('sha256').update(text).digest('hex');
    if (
      review?.version !== 1 ||
      typeof review.seal !== 'string' ||
      !/^[a-f0-9]{64}$/.test(review.seal) ||
      review.reviewer?.independent !== true ||
      typeof review.reviewer.id !== 'string' ||
      !/^[\w.-]{1,128}$/.test(review.reviewer.id)
    )
      return { status: 'invalid', reviewHash: hash };
    let approved = true;
    for (const arm of ['baseline', 'treatment'] as const) {
      const entry = review.arms?.[arm];
      if (
        !entry ||
        typeof entry.sourceHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(entry.sourceHash) ||
        typeof entry.behaviorallyRelevant !== 'boolean' ||
        typeof entry.rationale !== 'string' ||
        entry.rationale.trim().length < 20 ||
        entry.rationale.length > 2000
      )
        return { status: 'invalid', reviewHash: hash };
      if (
        entry.sourceHash !== submissions[arm].sourceHash ||
        review.seal !== seal
      )
        return { status: 'stale', reviewHash: hash };
      approved &&= entry.behaviorallyRelevant;
    }
    return { status: approved ? 'approved' : 'rejected', reviewHash: hash };
  } catch {
    return { status: 'invalid', reviewHash: null };
  }
}
