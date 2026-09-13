import { z } from 'astro/zod';

const text = z.string().trim().min(1);
const httpUrl = text.refine((value) => {
  if (!/^https?:\/\//.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch {
    return false;
  }
}, 'Expected an HTTP(S) URL without credentials');
const publicImage = text.refine((value) => {
  if (!/^\/(?!\/)[A-Za-z0-9/_ .-]+$/.test(value) || /\s/.test(value))
    return false;
  return value.split('/').every((part) => part !== '.' && part !== '..');
}, 'Expected a safe root-relative public image path');
const date = z.union([
  z.date(),
  z.iso.date().transform((value) => new Date(`${value}T00:00:00Z`)),
]);

/** Required metadata; labels become a nonempty list and date-only strings become UTC dates. */
export const blogSchema = z.object({
  title: text,
  description: text,
  date,
  image: z.union([publicImage, httpUrl]),
  labels: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
    )
    .pipe(z.array(text).min(1)),
  author: text,
  authorUrl: httpUrl,
  keywords: z.array(text),
  // The loader owns route identity; frontmatter must not override it.
  slug: z.never().optional(),
});

/** Rejects nested, reserved or ambiguous filenames instead of silently slugifying them. */
export function blogSlug(entry: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.mdx$/.test(entry)) {
    throw new Error(
      `Blog filenames must be flat lowercase kebab-case MDX: ${entry}`,
    );
  }
  const slug = entry.slice(0, -4);
  if (slug === 'index' || slug === 'pages')
    throw new Error(`Reserved blog slug: ${slug}`);
  return slug;
}

/** Returns a sorted copy; equal dates use locale-independent ascending IDs. */
export function sortPosts<T extends { id: string; data: { date: Date } }>(
  posts: T[],
): T[] {
  return [...posts].sort(
    (a, b) =>
      b.data.date.getTime() - a.data.date.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Builds the index path when omitted, or a trailing-slash path for a validated slug. */
export function blogPath(slug?: string): string {
  return slug === undefined ? '/blog/' : `/blog/${blogSlug(`${slug}.mdx`)}/`;
}

/** Resolves a validated image or local path independently of the request/preview host. */
export function productionUrl(path: string): string {
  return new URL(path, 'https://maelstrom-ai.co').href;
}
