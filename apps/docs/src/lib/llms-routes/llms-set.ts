import type { APIRoute, GetStaticPaths } from 'astro';
import docs from 'virtual:maelstrom/docs-versions';
import { generateLlmsTxt } from 'virtual:maelstrom/llms-txt-generator';
import config from 'virtual:maelstrom/versioned-llms';

import { rewriteMarkdownVersionLinks } from '../docs-versions';
import { versionSets } from '../versioned-llms';

export const prerender = true;

export const getStaticPaths = (() =>
  docs.versions.flatMap((version) =>
    versionSets(config, docs.pages[version] ?? []).map((set) => ({
      params: { version, slug: set.slug },
    })),
  )) satisfies GetStaticPaths;

export const GET: APIRoute = async (context) => {
  const version = context.params.version ?? '';
  const set = config.sets.find(({ slug }) => slug === context.params.slug);
  if (!set) return new Response(null, { status: 404 });
  const body = await generateLlmsTxt(context, {
    minify: true,
    description: `${set.label} (${version}): ${set.description}`,
    include: [`${version}/${set.directory}/**`],
  });
  return new Response(rewriteMarkdownVersionLinks(body, version, docs), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
