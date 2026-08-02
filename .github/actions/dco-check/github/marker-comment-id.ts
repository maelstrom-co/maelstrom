import { COMMENT_MARKER } from '../render/comment-marker.ts';
import { asRecord } from './as-record.ts';

export function markerCommentId(
  entry: unknown,
  viewerLogin: string,
): number | undefined {
  const comment = asRecord(entry);
  const user = asRecord(comment?.user);
  // Trust boundary: whatever this returns is what a later PATCH overwrites, so
  // it has to identify OUR comment and not merely a marked one. Requiring a Bot
  // author stops a human quoting the marker from hijacking the slot; requiring
  // the login stops any other app installed on this repo — and there are
  // several — from capturing it by posting the marker itself.
  //
  // Both logins are compared verbatim, and that is load-bearing: `viewerLogin`
  // comes from GraphQL `viewer { login }` and `user.login` from the REST
  // comments list, and both render a bot account with the suffix, as
  // `github-actions[bot]`. GraphQL's *other* rendering of the same account — a
  // `Bot` node's `login` — is the bare app slug, `github-actions`, which is why
  // GraphQL-based sticky-comment actions strip `[bot]` before comparing. Doing
  // that here, or adding the suffix to either side, makes the comparison never
  // match, and it fails silently: the run posts a fresh comment on every push
  // rather than failing.
  //
  // Case-sensitive on purpose, like the `type` comparison beside it. Both sides
  // are GitHub's own canonical spelling of one account, so they are already
  // byte-identical; a mismatch means the identity assumption broke, and the safe
  // reading of that is "not ours" rather than "close enough".
  if (user?.type !== 'Bot' || user.login !== viewerLogin) {
    return undefined;
  }
  const body = comment?.body;
  if (typeof body !== 'string' || !body.includes(COMMENT_MARKER)) {
    return undefined;
  }
  return typeof comment?.id === 'number' ? comment.id : undefined;
}
