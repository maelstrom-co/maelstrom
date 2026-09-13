# www blog authoring

Publish a post by adding one MDX file to `src/content/blog/<slug>.mdx`.
The Blog navigation link opens `/blog/`; each article has the canonical URL
`https://maelstrom-ai.co/blog/<slug>/`. An empty collection is supported.

## File and metadata contract

Use lowercase ASCII letters, digits and single hyphens in filenames, for example
`rendering-notes.mdx`. Nested files, uppercase names, repeated hyphens, dots in
slugs, and the reserved names `index` and `pages` fail validation. Do not add a
frontmatter `slug` override or a metadata sidecar.

This example is fictitious documentation, not a production article:

```mdx
---
title: Example engineering note
description: A short summary for readers and search results.
date: '2026-01-02'
image: /og.png
labels: 'engineering, rendering'
author: Example Author
authorUrl: https://example.com/author
keywords: [engineering, rendering]
---

## A section heading

Write Markdown here. MDX also supports JSX and expressions such as {6 * 7}.
```

All shown metadata fields are required. Title, description and author must be
nonempty after trimming. Use a valid `YYYY-MM-DD` date; dates display in UTC.
Posts sort by date descending, then filename slug ascending for equal dates.
Every entry is published, including future-dated entries: there is no draft or
scheduling policy. Keep unfinished articles outside this collection.

`labels` is a comma-separated string. Empty segments are removed and the remaining
labels are trimmed; at least one label must remain. `keywords` is a YAML list of
nonempty strings (an empty list is allowed). `authorUrl` must be an HTTP(S) URL
without credentials. The image must be either an HTTP(S) URL without credentials
or a root-relative public path using letters, digits, slashes, underscores, dots
and hyphens. Protocol-relative URLs, backslashes, whitespace, percent escapes and
dot-segment traversal are not accepted for public paths. Put local assets under
`public/` and omit `public` from the URL. Check that the image exists; validation
does not fetch remote images or inspect local image dimensions.

The page supplies its own title heading, description, date, labels and linked
author. Start the body at `##`. MDX is executable, trusted repository content, not
an upload format for untrusted authors.

## SEO and previews

Blog canonical, Open Graph and sitemap URLs use the production origin and a
trailing slash, even with a preview site override. Root-relative SEO images also
resolve against production. Other routes retain their existing SEO defaults.

The existing Layout request-host `noindex` guard is unchanged. Static HTML does
not re-evaluate that guard when served from a different host. The Cloudflare
prerender fixture builds did not emit a robots tag even with a preview `--site`
override; this is not proof of preview-host indexing protection. Neither these
tests nor the generated files establish hosting redirects between slash forms.

## Local checks

From the repository root, run the affected project gates:

```sh
NX_DAEMON=false bunx --no-install nx run '@maelstrom-co/www:typecheck' --skip-nx-cache
NX_DAEMON=false bunx --no-install nx run '@maelstrom-co/www:test' --skip-nx-cache
NX_DAEMON=false bunx --no-install nx run '@maelstrom-co/www:check' --skip-nx-cache
NX_DAEMON=false bunx --no-install nx run '@maelstrom-co/www:build' --skip-nx-cache
NX_DAEMON=false bunx --no-install nx run '@maelstrom-co/www:e2e' --skip-nx-cache
```

Schema and output tests live in `src/lib/blog.test.ts`. Fictitious MDX files live
only in `e2e/fixtures/blog/`. The harness copies build inputs into an OS temporary
directory, links dependencies without sharing app caches, and builds the actual
Astro collection/routes/adapter there. It tests an untouched collection separately
from injected fixtures and removes the temporary tree in `finally`; cleanup errors
fail the test. Do not copy fixtures into `src/content/blog/` or deploy fixture output.
Browser tests inspect both the actual development index and isolated built posts.
