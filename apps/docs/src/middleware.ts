import { defineMiddleware } from 'astro:middleware';
import docs from 'virtual:maelstrom/docs-versions';

import { rewriteVersionLinks, splitVersion } from './lib/docs-versions';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const located = splitVersion(context.url.pathname, docs.versions);
  const type = response.headers.get('content-type');
  if (!located || (type !== null && !type.includes('text/html'))) {
    return response;
  }
  const html = rewriteVersionLinks(
    await response.text(),
    located.version,
    docs,
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
