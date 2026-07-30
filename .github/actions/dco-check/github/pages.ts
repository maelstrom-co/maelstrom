import { PaginationLimitError } from './pagination-limit-error.ts';
import { request } from './request.ts';

export async function* pages(
  token: string,
  url: string,
  pageLimit: number,
): AsyncGenerator<unknown[]> {
  for (let page = 1; page <= pageLimit; page += 1) {
    const payload = await request(
      token,
      `${url}?per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(payload)) {
      throw new Error(`expected a list of results from ${url}`);
    }
    yield payload;
    if (payload.length < PAGE_SIZE) {
      return;
    }
  }
  // Only a short page or a throw ends this loop, so anything replaying a full
  // page forever would otherwise hold the required check pending with no
  // diagnostic at all.
  throw new PaginationLimitError(url, pageLimit);
}

const PAGE_SIZE = 100;
