import { describe, expect, it } from 'bun:test';
import {
  extractHrefs,
  extractIds,
  extractMarkdownLinks,
  resolveLink,
  SITE_ORIGIN,
  servableUrls,
} from './docs-links.ts';

describe('servableUrls', () => {
  it('serves a directory route with and without its trailing slash', () => {
    // Starlight emits the trailing-slash form and hand-written MDX the bare one.
    // Accepting only one of them would report half the site as dead.
    expect(servableUrls('guides/voice/index.html')).toEqual([
      '/guides/voice/',
      '/guides/voice',
      '/guides/voice/index.html',
    ]);
  });

  it('serves the site root from the top-level index', () => {
    expect(servableUrls('index.html')).toEqual(['/', '/index.html']);
  });

  it('serves a bare .html file from its directory form too', () => {
    // Astro emits the not-found page as `404.html` while its own canonical link
    // names `/404/`. Without this the 404 page reports itself as broken.
    expect(servableUrls('404.html')).toEqual(['/404.html', '/404', '/404/']);
  });

  it('serves a non-HTML asset only at its literal path', () => {
    expect(servableUrls('llms-full.txt')).toEqual(['/llms-full.txt']);
  });
});

describe('resolveLink', () => {
  it('treats a link to the docs origin as internal', () => {
    // The llms-txt config points at full https://docs.maelstrom-ai.co/... URLs.
    // Skipping them as "external" would exempt exactly the links most likely to
    // outlive the pages they name.
    expect(resolveLink(`${SITE_ORIGIN}/understanding/engine/`, '/')).toEqual({
      path: '/understanding/engine/',
      fragment: undefined,
    });
  });

  it('skips links that leave the site', () => {
    for (const href of [
      'https://github.com/maelstrom-co/maelstrom',
      'mailto:hi@example.com',
      'tel:+15551234',
      'javascript:void(0)',
    ]) {
      expect(resolveLink(href, '/guides/voice/')).toBeNull();
    }
  });

  it('skips protocol-relative links, including links to the docs host', () => {
    expect(resolveLink('//cdn.example.com/a.js', '/')).toBeNull();
    expect(resolveLink('//docs.maelstrom-ai.co/guides/', '/')).toBeNull();
  });

  it('resolves a relative link against the linking page, not the site root', () => {
    expect(resolveLink('../engine/', '/guides/voice/')).toEqual({
      path: '/guides/engine/',
      fragment: undefined,
    });
  });

  it('points a bare fragment at the page holding it', () => {
    expect(resolveLink('#configure-browser-vad', '/guides/voice/')).toEqual({
      path: '/guides/voice/',
      fragment: 'configure-browser-vad',
    });
  });

  it('separates the fragment and drops the query', () => {
    expect(resolveLink('/reference/client/#usage?v=2', '/')).toEqual({
      path: '/reference/client/',
      fragment: 'usage?v=2',
    });
    expect(resolveLink('/search/?q=vad', '/')).toEqual({
      path: '/search/',
      fragment: undefined,
    });
  });

  it('decodes escaped paths so they compare against real filenames', () => {
    expect(resolveLink('/reference/type%2Daliases/', '/')?.path).toBe(
      '/reference/type-aliases/',
    );
  });

  it('keeps a malformed escape rather than throwing on it', () => {
    // A link we cannot decode is still a link that has to be reported.
    expect(resolveLink('/reference/100%/', '/')?.path).toBe('/reference/100%/');
  });

  it('rejects a host that merely starts with the docs origin', () => {
    // A prefix comparison lets `docs.maelstrom-ai.co.<anything>` through as
    // internal, and the checker would then resolve somebody else's URL against
    // our own routes.
    expect(
      resolveLink('https://docs.maelstrom-ai.co.example.net/guides/', '/'),
    ).toBeNull();
    expect(
      resolveLink('https://docs.maelstrom-ai.co/guides/', '/'),
    ).not.toBeNull();
  });

  it('collapses dot segments in a root-relative path', () => {
    // A browser resolves this to /guides/engine/. Comparing the unnormalized
    // string against the route set reports a live page as dead.
    expect(resolveLink('/guides/voice/../engine/', '/')?.path).toBe(
      '/guides/engine/',
    );
  });

  it('resolves a literal index.html against the page holding it', () => {
    expect(resolveLink('index.html', '/guides/voice/')?.path).toBe(
      '/guides/voice/index.html',
    );
  });

  it('detects a link to a page the build no longer publishes', () => {
    // The regression this whole check exists for: TypeDoc renders a symbol from
    // a public signature as a link, so deleting the symbol's page strands the
    // link on a page nobody edited.
    const published = new Set(
      servableUrls('reference/client/classes/httpconnector/index.html'),
    );
    const link = resolveLink(
      '/reference/client/interfaces/engineconnector/',
      '/reference/client/classes/httpconnector/',
    );

    expect(link).not.toBeNull();
    expect(published.has(link?.path ?? '')).toBe(false);
  });
});

describe('extractHrefs', () => {
  it('reads quoted and unquoted attributes from compressed markup', () => {
    // compressHTML collapses whitespace, so the parser cannot assume tidy input.
    const html = `<a href="/a/">A</a><a href='/b/'>B</a><a href=/c/>C</a>`;
    expect(extractHrefs(html)).toEqual(['/a/', '/b/', '/c/']);
  });

  it('ignores an attribute that merely ends in href', () => {
    expect(extractHrefs('<link data-href="/nope/" href="/yes/">')).toEqual([
      '/yes/',
    ]);
  });
});

describe('extractIds', () => {
  it('collects the anchors a page offers to incoming fragments', () => {
    expect([...extractIds('<h2 id="hold-a-turn">x</h2><p id=other>')]).toEqual([
      'hold-a-turn',
      'other',
    ]);
  });
});

describe('extractMarkdownLinks', () => {
  it('reads link targets out of the llms bundles', () => {
    // These ship as text, so a stale path in them is invisible to an HTML crawl.
    const text =
      '- [Engine](/reference/engine/) and [Client](/reference/client/)';
    expect(extractMarkdownLinks(text)).toEqual([
      '/reference/engine/',
      '/reference/client/',
    ]);
  });
});
