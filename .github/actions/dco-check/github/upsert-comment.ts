import type { Config } from '../config/config.ts';
import { API_BASE } from './api-base.ts';
import { type FindComment, findComment } from './find-comment.ts';
import { type Request, request } from './request.ts';

export function createUpsertComment(
  findComment: FindComment,
  request: Request,
) {
  return async function upsertComment(
    config: Config,
    body: string,
  ): Promise<void> {
    const { token, repository, prNumber } = config;
    const existing = await findComment(config);
    const { method, url } =
      existing === undefined
        ? {
            method: 'POST',
            url: `${API_BASE}/repos/${repository}/issues/${prNumber}/comments`,
          }
        : {
            method: 'PATCH',
            url: `${API_BASE}/repos/${repository}/issues/comments/${existing}`,
          };
    await request(token, url, { method, body: JSON.stringify({ body }) });
  };
}

export type UpsertComment = ReturnType<typeof createUpsertComment>;

export const upsertComment = createUpsertComment(findComment, request);
