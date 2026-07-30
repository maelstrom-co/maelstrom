import type { Config } from '../config/config.ts';
import { API_BASE } from './api-base.ts';
import { findComment } from './find-comment.ts';
import { request } from './request.ts';

export async function upsertComment(
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
}
