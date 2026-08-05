import { describe, expect, it } from 'bun:test';
import { createPages } from './pages.ts';
import { PaginationLimitError } from './pagination-limit-error.ts';
import type { Request } from './request.ts';

const TOKEN = 'ghs_token';
const URL = 'https://api.github.com/repos/o/r/pulls/7/commits';
const FULL_PAGE = Array.from({ length: 100 }, (_, index) => index);

describe('pages', () => {
  it('stops after a short page', async () => {
    const urls: string[] = [];
    const pages = createPages(recording(urls, [[1, 2, 3]]));
    expect(await collect(pages(TOKEN, URL, 5))).toEqual([[1, 2, 3]]);
    expect(urls).toEqual([`${URL}?per_page=100&page=1`]);
  });

  it('stops after an empty page', async () => {
    const pages = createPages(async () => []);
    expect(await collect(pages(TOKEN, URL, 5))).toEqual([[]]);
  });

  it('walks on past a full page', async () => {
    const urls: string[] = [];
    const pages = createPages(recording(urls, [FULL_PAGE, ['tail']]));
    expect(await collect(pages(TOKEN, URL, 5))).toEqual([FULL_PAGE, ['tail']]);
    expect(urls).toEqual([
      `${URL}?per_page=100&page=1`,
      `${URL}?per_page=100&page=2`,
    ]);
  });

  it('refuses to paginate past the page limit', async () => {
    // A page that stays full forever would otherwise hold the required check
    // pending with no diagnostic at all.
    const urls: string[] = [];
    const pages = createPages(recording(urls, [FULL_PAGE, FULL_PAGE]));
    await expect(collect(pages(TOKEN, URL, 2))).rejects.toThrow(
      PaginationLimitError,
    );
    expect(urls).toHaveLength(2);
  });

  it('yields every page it read before hitting the limit', async () => {
    const pages = createPages(async () => FULL_PAGE);
    const yielded: unknown[][] = [];
    await expect(
      (async () => {
        for await (const page of pages(TOKEN, URL, 3)) {
          yielded.push(page);
        }
      })(),
    ).rejects.toThrow(PaginationLimitError);
    expect(yielded).toHaveLength(3);
  });

  it('refuses a payload that is not a list', async () => {
    const pages = createPages(async () => ({ message: 'Not Found' }));
    await expect(collect(pages(TOKEN, URL, 5))).rejects.toThrow(
      `expected a list of results from ${URL}`,
    );
  });

  it('passes the token through to every request', async () => {
    const tokens: string[] = [];
    const pages = createPages(async (token) => {
      tokens.push(token);
      return tokens.length < 2 ? FULL_PAGE : [];
    });
    await collect(pages(TOKEN, URL, 5));
    expect(tokens).toEqual([TOKEN, TOKEN]);
  });
});

function recording(urls: string[], payloads: unknown[][]): Request {
  return async (_token, url) => {
    urls.push(url);
    return payloads[urls.length - 1] ?? [];
  };
}

async function collect(
  source: AsyncGenerator<unknown[]>,
): Promise<unknown[][]> {
  const items: unknown[][] = [];
  for await (const item of source) {
    items.push(item);
  }
  return items;
}
