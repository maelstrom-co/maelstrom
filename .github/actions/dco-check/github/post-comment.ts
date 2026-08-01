import type { Config } from '../config/config.ts';
import { errorMessage } from '../report/error-message.ts';
import { RequestError } from './request-error.ts';
import { type UpsertComment, upsertComment } from './upsert-comment.ts';

// The check IS the verdict; the comment is UX. A failed upsert annotates and
// leaves the exit code alone.
export function createPostComment(upsertComment: UpsertComment) {
  return async function postComment(
    config: Config,
    body: string,
  ): Promise<void> {
    try {
      await upsertComment(config, body);
    } catch (error) {
      // A denied comment never self-heals — every later run fails the same way,
      // and a fork contributor staring at a red check has no other explanation
      // anywhere. An annotation does not move the exit code, so saying so
      // loudly costs nothing.
      const denied =
        error instanceof RequestError &&
        (error.status === 401 || error.status === 403);
      const severity = denied ? 'error' : 'warning';
      const hint = denied
        ? ' — check that GITHUB_TOKEN has pull-requests: write'
        : '';
      console.log(
        `::${severity} title=DCO::could not post the verdict comment (${errorMessage(error)})${hint}`,
      );
    }
  };
}

export type PostComment = ReturnType<typeof createPostComment>;

export const postComment = createPostComment(upsertComment);
