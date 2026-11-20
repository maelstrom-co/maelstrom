import type { APIRoute, GetStaticPaths } from 'astro';
import docs from 'virtual:maelstrom/docs-versions';
import { generateLlmsTxt } from 'virtual:maelstrom/llms-txt-generator';
import config from 'virtual:maelstrom/versioned-llms';

import { rewriteMarkdownVersionLinks } from '../docs-versions';
import {
  LLMS_FILES,
  type LlmsFile,
  absoluteMarkdownLinks,
  llmsIndex,
  llmsPageFilter,
} from '../versioned-llms';

export const prerender = true;

export const getStaticPaths = (() =>
  docs.versions.flatMap((version) =>
    LLMS_FILES.map((file) => ({ params: { version, file } })),
  )) satisfies GetStaticPaths;

export const GET: APIRoute = async (context) => {
  const version = context.params.version ?? '';
  const file = context.params.file as LlmsFile;
  let body: string;
  if (file === 'llms') {
    body = absoluteMarkdownLinks(
      rewriteMarkdownVersionLinks(
        llmsIndex(config, docs, version),
        version,
        docs,
      ),
      context.site ?? context.url,
    );
  } else {
    const full = file === 'llms-full';
    body = rewriteMarkdownVersionLinks(
      await generateLlmsTxt(context, {
        minify: !full,
        description: `This is the ${full ? 'full' : 'abridged'} ${version} developer documentation for ${config.title}`,
        ...llmsPageFilter(config, version, file),
      }),
      version,
      docs,
    );
  }
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
