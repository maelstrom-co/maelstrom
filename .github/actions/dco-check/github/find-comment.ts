import type { Config } from '../config/config.ts';
import { annotateWarning } from '../report/annotate-warning.ts';
import { API_BASE } from './api-base.ts';
import { markerCommentId } from './marker-comment-id.ts';
import { type Pages, pages } from './pages.ts';
import { type ViewerLogin, viewerLogin } from './viewer-login.ts';

export function createFindComment(viewerLogin: ViewerLogin, pages: Pages) {
  return async function findComment(
    config: Config,
  ): Promise<number | undefined> {
    const { token, repository, prNumber } = config;
    // Resolved once, before paging: without our own login nothing below can
    // prove a comment is ours, and reporting "none found" is the only safe
    // answer — PATCHing an unproven comment overwrites whoever does own it. The
    // cost is a duplicate comment per push, so it must not pass silently; the
    // severity stays at warning because this path cannot move the exit code,
    // and `post-comment` reserves `::error` for a token that was outright
    // denied.
    const login = await viewerLogin(config);
    if (login === undefined) {
      annotateWarning(
        'could not confirm which comment belongs to this workflow — posting a new verdict comment instead of updating the existing one',
      );
      return undefined;
    }
    const url = `${API_BASE}/repos/${repository}/issues/${prNumber}/comments`;
    for await (const payload of pages(token, url, COMMENT_PAGE_LIMIT)) {
      for (const entry of payload) {
        const id = markerCommentId(entry, login);
        if (id !== undefined) {
          return id;
        }
      }
    }
    return undefined;
  };
}

export type FindComment = ReturnType<typeof createFindComment>;

export const findComment = createFindComment(viewerLogin, pages);

const COMMENT_PAGE_LIMIT = 20;
