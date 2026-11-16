import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';
import { JSDOM, VirtualConsole } from 'jsdom';

import { markdownPath } from './markdown-path';
import { documentToMarkdown } from './page-markdown';

export const SMALL_DOCS_BUDGET_BYTES = 48_000;

/** Resolve only a path against the local development server. */
export function localPageUrl(pathname: string, port: number): URL {
  const url = new URL(`http://localhost:${port}`);
  url.pathname = pathname;
  return url;
}

/** Fail instead of silently growing the abridged onboarding context. */
export function assertSmallDocsBudget(content: string): void {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > SMALL_DOCS_BUDGET_BYTES) {
    throw new Error(
      `llms-small.txt is ${bytes} bytes; the onboarding budget is ${SMALL_DOCS_BUDGET_BYTES}. Curate the included pages before increasing it.`,
    );
  }
}

/** Convert the rendered page without running scripts or loading resources. */
export function htmlToMarkdown(html: string, url: URL): string | null {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    // CSS rendering is irrelevant to this text-only projection.
    if (!('type' in error) || error.type !== 'css-parsing')
      console.error(error);
  });
  const dom = new JSDOM(html, { url: url.href, virtualConsole });
  try {
    return documentToMarkdown(dom.window.document);
  } finally {
    dom.window.close();
  }
}

/** Export the same rendered documentation used by the copy control. */
export function llmDocs(): AstroIntegration {
  let site: URL;
  return {
    name: 'maelstrom-llm-docs',
    hooks: {
      'astro:config:done': ({ config }) => {
        if (!config.site)
          throw new Error('Markdown exports require a site URL.');
        site = new URL(config.site);
      },
      'astro:server:setup': ({ server, logger }) => {
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url ?? '/', site).pathname;
          if (!pathname.endsWith('.md')) return next();
          if (request.method !== 'GET' && request.method !== 'HEAD')
            return next();
          const address = server.httpServer?.address();
          if (!address || typeof address === 'string') return next();
          const pagePath = `${pathname.slice(0, -3)}/`;
          // Request headers never select the upstream host.
          const upstream = localPageUrl(pagePath, address.port);
          try {
            const page = await fetch(upstream, {
              redirect: 'manual',
              signal: AbortSignal.timeout(30_000),
            });
            if (page.status >= 500) {
              response.statusCode = 500;
              response.end('Markdown rendering failed.');
              return;
            }
            // Only the text projection uses the browser-facing host.
            const publicPage = new URL(upstream);
            publicPage.host = request.headers.host ?? upstream.host;
            if (server.config.server.https) publicPage.protocol = 'https:';
            const markdown =
              page.status === 200 &&
              page.headers.get('content-type')?.includes('text/html')
                ? htmlToMarkdown(await page.text(), publicPage)
                : null;
            if (markdown === null) {
              return next();
            }
            response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            response.end(request.method === 'HEAD' ? undefined : markdown);
          } catch (error) {
            logger.error(`Markdown rendering failed: ${String(error)}`);
            response.statusCode = 500;
            response.end('Markdown rendering failed.');
          }
        });
      },
      'astro:build:done': async ({ dir, pages, logger }) => {
        const small = await readFile(new URL('llms-small.txt', dir), 'utf8');
        assertSmallDocsBudget(small);
        let count = 0;
        for (const { pathname } of pages) {
          const pagePath = `/${pathname.replace(/^\//, '').replace(/\/?$/, '/')}`;
          const source = new URL(`.${pagePath}index.html`, dir);
          let html: string;
          try {
            html = await readFile(source, 'utf8');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
          }
          const markdown = htmlToMarkdown(html, new URL(pagePath, site));
          if (markdown === null) continue;
          const destination = new URL(`.${markdownPath(pagePath)}`, dir);
          await mkdir(dirname(fileURLToPath(destination)), { recursive: true });
          await writeFile(destination, markdown);
          count++;
        }
        logger.info(
          `Exported ${count} Markdown pages. Abridged context: ${Buffer.byteLength(small)} / ${SMALL_DOCS_BUDGET_BYTES} bytes.`,
        );
      },
    },
  };
}
