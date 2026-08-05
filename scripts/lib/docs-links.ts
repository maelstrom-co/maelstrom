/** Origin the docs site is built for; links using it are internal, not external. */
export const SITE_ORIGIN = 'https://docs.maelstrom-ai.co';

/** A link resolved to the page it targets, plus the fragment it expects there. */
export type ResolvedLink = {
  /** Site-absolute path, always leading-slash, query stripped. */
  readonly path: string;
  /** Fragment without `#`, or undefined when the link names no anchor. */
  readonly fragment?: string;
};

const HREF = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const ID = /\sid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
// Markdown link targets, for the llms-*.txt files. Those are published as text,
// so a stale path in them is invisible to any HTML-only crawl.
const MARKDOWN_LINK = /\]\(([^)\s]+)/g;

function* matchValues(source: string, pattern: RegExp): Generator<string> {
  pattern.lastIndex = 0;
  let match = pattern.exec(source);
  while (match !== null) {
    yield match[1] ?? match[2] ?? match[3] ?? '';
    match = pattern.exec(source);
  }
}

/** Every `href` value in a document, in source order and unfiltered. */
export function extractHrefs(html: string): string[] {
  return [...matchValues(html, HREF)];
}

/** Every `id` a document defines, which is what its incoming fragments may name. */
export function extractIds(html: string): Set<string> {
  return new Set(matchValues(html, ID));
}

/** Every markdown link target in a text document. */
export function extractMarkdownLinks(text: string): string[] {
  return [...matchValues(text, MARKDOWN_LINK)];
}

/**
 * URLs that serve a built file. A directory-format build writes `index.html`
 * per route, so both the canonical trailing-slash form and the bare form have
 * to count as live — Starlight emits the first and hand-written MDX the second.
 */
export function servableUrls(relativeFilePath: string): string[] {
  const normalized = relativeFilePath.split('\\').join('/');
  // The literal path is always servable too. A hand-written `href="index.html"`
  // resolves to it, and omitting it reports a published page as dead.
  if (normalized === 'index.html') return ['/', '/index.html'];
  if (normalized.endsWith('/index.html')) {
    const directory = `/${normalized.slice(0, -'/index.html'.length)}`;
    return [`${directory}/`, directory, `/${normalized}`];
  }
  const url = `/${normalized}`;
  if (normalized.endsWith('.html')) {
    const withoutExtension = url.slice(0, -'.html'.length);
    // Static hosts serve `foo.html` for `/foo/` as well. Astro's 404 page relies
    // on it: it is emitted as `404.html` and its own canonical names `/404/`.
    return [url, withoutExtension, `${withoutExtension}/`];
  }
  return [url];
}

/**
 * Resolves one link against the page holding it, or returns null when the link
 * leaves the site and is therefore not ours to verify.
 *
 * `fromPath` must be the site-absolute path of the containing page, because a
 * relative href resolves against the page's directory rather than the site root.
 */
export function resolveLink(
  href: string,
  fromPath: string,
): ResolvedLink | null {
  const trimmed = href.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('//')) return null;

  // Resolving through `URL` rather than string surgery is what makes the three
  // hard cases correct at once: a bare `#anchor` inherits the current page, dot
  // segments collapse the way a browser collapses them, and the origin is
  // compared exactly — a prefix test would let `https://docs.maelstrom-ai.co.<evil>/`
  // through as internal.
  let url: URL;
  try {
    url = new URL(trimmed, `${SITE_ORIGIN}${fromPath}`);
  } catch {
    // Unparseable as a URL even against a base, so not a link we can resolve.
    return null;
  }

  // Covers every other scheme too: mailto, tel, data, and javascript all parse
  // with an opaque origin, and any other host is somebody else's to keep alive.
  if (url.origin !== SITE_ORIGIN) return null;

  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : '';

  return {
    path: decodeSafely(url.pathname),
    fragment: fragment === '' ? undefined : decodeSafely(fragment),
  };
}

// A malformed percent-escape throws rather than round-tripping, and a link that
// cannot be decoded is still a link we have to report against its literal form.
function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
