import type { Config } from '../config/config.ts';
import { COMMENT_MARKER } from '../render/comment-marker.ts';
import { API_BASE } from './api-base.ts';
import { pages } from './pages.ts';

export async function findComment(config: Config): Promise<number | undefined> {
  const { token, repository, prNumber } = config;
  const url = `${API_BASE}/repos/${repository}/issues/${prNumber}/comments`;
  for await (const payload of pages(token, url, COMMENT_PAGE_LIMIT)) {
    for (const entry of payload) {
      const id = markerCommentId(entry);
      if (id !== undefined) {
        return id;
      }
    }
  }
  return undefined;
}

const COMMENT_PAGE_LIMIT = 20;

function markerCommentId(entry: unknown): number | undefined {
  const comment = asRecord(entry);
  // Requiring a Bot author means a human quoting the marker cannot hijack the
  // slot and make every later run edit their comment instead.
  if (asRecord(comment?.user)?.type !== 'Bot') {
    return undefined;
  }
  const body = comment?.body;
  if (typeof body !== 'string' || !body.includes(COMMENT_MARKER)) {
    return undefined;
  }
  return typeof comment?.id === 'number' ? comment.id : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
