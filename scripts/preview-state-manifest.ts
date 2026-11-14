import type { IsolationGithubRequest } from './preview-state-isolation.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Enumerates closed as well as open PRs to preserve known outputs-only stages. */
export async function isolationPullNumbers(request: IsolationGithubRequest) {
  const numbers = new Set<string>();
  for (let page = 1; page <= 10; page++) {
    const pulls = await request<unknown>(
      `/pulls?state=all&sort=created&direction=asc&per_page=100&page=${page}`,
    );
    if (!Array.isArray(pulls) || pulls.length > 100)
      throw new Error('ISOLATION_PR_INVENTORY_INVALID');
    for (const pull of pulls) {
      if (
        !record(pull) ||
        !Number.isSafeInteger(pull.number) ||
        Number(pull.number) < 1
      )
        throw new Error('ISOLATION_PR_INVENTORY_INVALID');
      const number = String(pull.number);
      if (numbers.has(number))
        throw new Error('ISOLATION_PR_INVENTORY_CHANGED');
      numbers.add(number);
    }
    if (pulls.length < 100) return [...numbers].sort();
  }
  throw new Error('ISOLATION_PR_INVENTORY_LIMIT');
}
