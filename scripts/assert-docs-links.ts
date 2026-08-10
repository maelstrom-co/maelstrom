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

/**
 * Dead targets that already shipped when this check was written, so the gate
 * could be switched on without a config rewrite ahead of it.
 *
 * All of them are one TypeDoc behaviour, and none of them is fixable from the
 * authored pages. A package with more than one entry point gets a generated
 * index whose "Modules" list links to `<module>/readme/`, but no module readme
 * page is ever emitted, so every entry in that list is dead. Emptying this set
 * means changing TypeDoc's output strategy, which moves reference URLs across
 * the whole site.
 *
 * Nothing an author wrote belongs here. A hand-written link to a route that
 * does not exist is a typo with a one-line fix, so it fails instead.
 *
 * The list is exact, not a floor. An unlisted dead link fails, and so does a
 * listed one that starts resolving — so it can only shrink, and it cannot rot
 * the way a skip-if-missing list does.
 */
const KNOWN_DEAD_TARGETS = new Set([
  '/reference/realtime-protocol/packages/realtime-protocol/src/livekit/readme/',
  '/reference/realtime-protocol/packages/realtime-protocol/src/livekit-wire/readme/',
  '/reference/realtime-protocol/packages/realtime-protocol/src/openai/readme/',
  '/reference/realtime-protocol/packages/realtime-protocol/src/readme/',
  '/reference/realtime-vad/packages/realtime-vad/src/readme/',
  '/reference/realtime-vad/packages/realtime-vad/src/vad-assets/readme/',
]);

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
const seenKnownDead = new Set<string>();

function check(links: string[], fromPath: string, file: string): void {
  for (const href of links) {
    const target = resolveLink(href, fromPath);
    if (target === null) continue;

    if (!servable.has(target.path)) {
      if (KNOWN_DEAD_TARGETS.has(target.path)) {
        seenKnownDead.add(target.path);
        continue;
      }
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

// A known-dead target that now resolves is fixed, and leaving it listed would
// let the next real break hide behind it.
for (const target of KNOWN_DEAD_TARGETS) {
  if (!seenKnownDead.has(target)) {
    problems.push({
      file: relative(process.cwd(), import.meta.path),
      message: `KNOWN_DEAD_TARGETS lists ${target}, but nothing links to it any more. Delete the entry.`,
    });
  }
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
  `Checked ${htmlFiles.length} pages: every internal link resolves to a published route ` +
    `(${KNOWN_DEAD_TARGETS.size} known-dead target(s) still listed).`,
);
