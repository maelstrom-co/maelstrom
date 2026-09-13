import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  extractHrefs,
  extractIds,
  extractMarkdownLinks,
  resolveLink,
  servableUrls,
} from './lib/docs-links.ts';

// TypeDoc links a symbol's page from every signature that mentions it, so
// removing one generated page strands links on pages nobody edited. The
// Playwright suite asserts links only on the voice guides, which is how eleven
// pages once shipped pointing at four deleted routes with CI green. This walks
// the whole built site instead, so the blast radius of a content change is
// measured rather than assumed.

const distRoot = resolve(import.meta.dir, '../apps/docs/dist');

type Problem = { file: string; message: string };

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

let files: string[];
try {
  files = walk(distRoot);
} catch {
  console.error(
    `::error::${relative(process.cwd(), distRoot)} does not exist. Run \`nx run docs:build\` first.`,
  );
  process.exit(1);
}

// Every URL the built site answers, so a link is dead precisely when it misses.
const servable = new Set<string>();
for (const file of files) {
  for (const url of servableUrls(relative(distRoot, file))) servable.add(url);
}

// Fragments are checked against the target page, so ids are indexed by the URL
// that serves them rather than by file path.
const idsByUrl = new Map<string, Set<string>>();
const htmlFiles = files.filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  const ids = extractIds(readFileSync(file, 'utf8'));
  for (const url of servableUrls(relative(distRoot, file))) {
    idsByUrl.set(url, ids);
  }
}

const problems: Problem[] = [];

function check(links: string[], fromPath: string, file: string): void {
  for (const href of links) {
    const target = resolveLink(href, fromPath);
    if (target === null) continue;

    if (!servable.has(target.path)) {
      problems.push({
        file,
        message: `links to ${target.path}, which the build does not publish (href="${href}")`,
      });
      continue;
    }
    if (target.fragment === undefined) continue;

    // Only HTML targets are indexed, and only they can be checked. A fragment
    // on a `.txt` target is a markdown self-anchor — the llms bundles carry
    // their own tables of contents, so `[Engine](#engine)` inside one resolves
    // against that document's headings and is not a site route at all.
    const ids = idsByUrl.get(target.path);
    if (ids !== undefined && !ids.has(target.fragment)) {
      problems.push({
        file,
        message: `links to ${target.path}#${target.fragment}, but that page defines no such id`,
      });
    }
  }
}

for (const file of htmlFiles) {
  const [fromPath] = servableUrls(relative(distRoot, file));
  if (fromPath === undefined) continue;
  check(
    extractHrefs(readFileSync(file, 'utf8')),
    fromPath,
    relative(process.cwd(), file),
  );
}

// The llms-*.txt bundles carry markdown links into the same URL space, and a
// dead one there reaches every LLM consumer while the site itself looks clean.
for (const file of files.filter((f) => f.endsWith('.txt'))) {
  const [fromPath] = servableUrls(relative(distRoot, file));
  if (fromPath === undefined) continue;
  check(
    extractMarkdownLinks(readFileSync(file, 'utf8')),
    fromPath,
    relative(process.cwd(), file),
  );
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`::error file=${problem.file}::${problem.message}`);
  }
  console.error(
    `\n${problems.length} problem(s) across ${new Set(problems.map((p) => p.file)).size} file(s).`,
  );
  process.exit(1);
}

console.log(
  `Checked ${htmlFiles.length} pages: every internal link resolves to a published route.`,
);
