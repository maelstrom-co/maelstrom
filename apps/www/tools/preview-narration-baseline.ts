import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { extractNarration } from '../src/lib/blog-narration';
import { parseNarrationHtml } from './blog-narration-publication';

export const articlePath =
  /^\/blog\/(?!index\/|pages\/)[a-z0-9]+(?:-[a-z0-9]+)*\/$/u;
export const maxResponseBytes = 2 * 1024 * 1024;
export const maxTotalBytes = 10 * 1024 * 1024;
export const maxArticleCharacters = 20_000;
export const maxTotalCharacters = 100_000;
const maxBaselineRoutes = 300;
const maxRouteLength = 200;
const maxInventoryLength = 90_000;
const hashPattern = /^[a-f0-9]{64}$/u;

const validRoute = (path: string) =>
  path.length <= maxRouteLength && articlePath.exec(path)?.[0] === path;

const textHash = (text: string) =>
  createHash('sha256').update(text.replace(/\s+/gu, ' '), 'utf8').digest('hex');

export function readNarrationText(
  document: Document,
  allowLegacy: boolean,
  preserveParagraphs = false,
) {
  const main = document.querySelectorAll('main.blog-page');
  const article = document.querySelectorAll('main.blog-page > article');
  const header = document.querySelectorAll('main.blog-page > article > header');
  const titles = document.querySelectorAll(
    'main.blog-page > article > header > h1',
  );
  const bodies = document.querySelectorAll(
    'main.blog-page > article > div.blog-prose',
  );
  const title = titles[0];
  const description = title?.nextElementSibling;
  const body = bodies[0];
  if (
    main.length !== 1 ||
    article.length !== 1 ||
    header.length !== 1 ||
    titles.length !== 1 ||
    bodies.length !== 1 ||
    !title ||
    description?.tagName !== 'P' ||
    !body
  )
    return;
  const sections = [title, description, body];
  const marked = [...document.querySelectorAll('[data-narration-text]')];
  if (
    !(allowLegacy && marked.length === 0) &&
    (marked.length !== 3 ||
      sections.some((section, index) => section !== marked[index]))
  )
    return;
  return (
    extractNarration(document, sections, preserveParagraphs).text || undefined
  );
}

interface BaselineIdentity {
  run: string;
  job: string;
  attempt: string;
  repository: string;
  pull: string;
  head: string;
  mergeBase: string;
}

export function baselineCandidatePaths(comparison: {
  posts: readonly { previousPath: string | null }[];
  removedPaths: readonly string[];
}) {
  const paths = comparison.posts.flatMap(({ previousPath }) =>
    previousPath && validRoute(previousPath) ? [previousPath] : [],
  );
  if (comparison.posts.some(({ previousPath }) => previousPath === null)) {
    paths.push(...comparison.removedPaths.filter(validRoute));
  }
  return [...new Set(paths)];
}

export async function buildNarrationBaseline(
  clientOutput: string,
  identity: BaselineIdentity,
  selectedPaths: readonly string[],
) {
  const directory = join(clientOutput, 'blog');
  if (!(await lstat(directory)).isDirectory())
    throw new Error('Missing built blog directory');
  let bytes = 0;
  const page = async (file: string) => {
    const filename = join(directory, file);
    const stat = await lstat(filename);
    if (
      !stat.isFile() ||
      stat.size > maxResponseBytes ||
      bytes + stat.size > maxTotalBytes
    ) {
      throw new Error('Invalid or oversized baseline HTML');
    }
    bytes += stat.size;
    return parseNarrationHtml(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await readFile(filename),
      ),
    );
  };
  const archive = await page('index.html');
  const mains = archive.querySelectorAll('main.blog-archive');
  const main = mains[0];
  if (mains.length !== 1 || !main)
    throw new Error('Missing baseline blog archive');
  const archivePaths = new Set<string>();
  for (const link of main.querySelectorAll('.blog-list .blog-card h2 > a')) {
    const path = link.getAttribute('href');
    if (!path || !validRoute(path) || archivePaths.has(path)) {
      throw new Error('Invalid or duplicate baseline blog route');
    }
    archivePaths.add(path);
  }
  const listCount = main.querySelectorAll(':scope > .blog-list').length;
  const emptyCount = main.querySelectorAll(':scope > .blog-empty').length;
  if (
    (archivePaths.size > 0 && (listCount !== 1 || emptyCount !== 0)) ||
    (archivePaths.size === 0 && (listCount !== 0 || emptyCount !== 1))
  )
    throw new Error('Unknown baseline archive template');
  if (archivePaths.size > maxBaselineRoutes)
    throw new Error('Too many baseline blog routes');

  const builtPaths = new Set<string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'index.html') continue;
    const path = `/blog/${entry.name}/`;
    if (!entry.isDirectory() || !validRoute(path))
      throw new Error('Unknown baseline blog route');
    builtPaths.add(path);
  }
  if ([...builtPaths].some((path) => !archivePaths.has(path)))
    throw new Error('Incomplete baseline archive');

  const routes = new Map<string, string | null>(
    [...archivePaths].map((path) => [path, null]),
  );
  let characters = 0;
  for (const path of new Set(selectedPaths)) {
    if (!builtPaths.has(path)) continue;
    const slug = path.slice('/blog/'.length, -1);
    const document = await page(`${slug}/index.html`).catch(() => undefined);
    if (!document) continue;
    const text = readNarrationText(document, true);
    if (
      !text ||
      text.length > maxArticleCharacters ||
      characters + text.length > maxTotalCharacters
    )
      continue;
    characters += text.length;
    routes.set(path, textHash(text));
  }
  const inventory = JSON.stringify({ identity, routes: [...routes] });
  if (inventory.length > maxInventoryLength)
    throw new Error('Oversized baseline inventory');
  return inventory;
}

export function compareNarrationBaseline(
  inventory: string,
  expected: BaselineIdentity,
  changes: readonly { path: string; previousPath: string | null }[],
  removedPaths: readonly string[],
) {
  const reject = () => false;
  if (!inventory || inventory.length > maxInventoryLength) return reject;
  let value: unknown;
  try {
    value = JSON.parse(inventory);
  } catch {
    return reject;
  }
  if (!record(value) || !record(value.identity) || !Array.isArray(value.routes))
    return reject;
  const identity = value.identity;
  if (
    !Object.entries(expected).every(
      ([key, setting]) =>
        key === 'attempt' || (setting && identity[key] === setting),
    ) ||
    typeof identity.attempt !== 'string' ||
    !/^[1-9]\d{0,8}$/u.test(identity.attempt) ||
    !/^[1-9]\d{0,8}$/u.test(expected.attempt) ||
    Number(identity.attempt) > Number(expected.attempt)
  )
    return reject;
  if (value.routes.length > maxBaselineRoutes) return reject;
  const routes = new Map<string, string | null>();
  for (const entry of value.routes) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !validRoute(entry[0]) ||
      (entry[1] !== null &&
        (typeof entry[1] !== 'string' ||
          hashPattern.exec(entry[1])?.[0] !== entry[1])) ||
      routes.has(entry[0])
    )
      return reject;
    routes.set(entry[0], entry[1]);
  }
  const previousPaths = new Map(
    changes.map(({ path, previousPath }) => [path, previousPath]),
  );
  const removedHashes = removedPaths.map((path) => routes.get(path));
  return (path: string, text: string) => {
    const previousPath = previousPaths.get(path);
    if (previousPath === undefined) return false;
    if (previousPath !== path && routes.has(path)) return false;
    const hash = textHash(text);
    if (previousPath === null) {
      return removedHashes.every(
        (previous) => previous != null && previous !== hash,
      );
    }
    const previousHash = routes.get(previousPath);
    return previousHash != null && previousHash !== hash;
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
