import { DEV_VERSION, type DocsVersions } from './docs-versions';

/** The llms text files each version serves at `/<version>/<file>.txt`. */
export const LLMS_FILES = ['llms', 'llms-full', 'llms-small'] as const;

/** One of {@link LLMS_FILES}. */
export type LlmsFile = (typeof LLMS_FILES)[number];

/** A focused llms text set: one top-level folder of a version. */
export interface VersionedLlmsSet {
  label: string;
  description: string;
  /** The folder relative to the version root, such as `guides`. */
  directory: string;
  /** The file name under `/<version>/_llms-txt/`, without `.txt`. */
  slug: string;
}

/** A link listed under "Optional" in each `llms.txt`. */
export interface LlmsLink {
  label: string;
  url: string;
  description?: string;
}

/** The build-time configuration the llms routes read. */
export interface VersionedLlmsConfig {
  title: string;
  description: string;
  /** The folder whose pages make up the abridged corpus. */
  abridgedDirectory: string;
  sets: VersionedLlmsSet[];
  optionalLinks: LlmsLink[];
  /** The details section of each version's `llms.txt`, by version. */
  details: Record<string, string>;
}

/** The file name a set label is published under. */
export function llmsSetSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The sets a version has pages for. */
export function versionSets(
  config: Pick<VersionedLlmsConfig, 'sets'>,
  pages: readonly string[],
): VersionedLlmsSet[] {
  return config.sets.filter((set) =>
    pages.some((page) => page.startsWith(`${set.directory}/`)),
  );
}

/** The content globs a version's file or set renders. */
export function llmsPageFilter(
  config: Pick<VersionedLlmsConfig, 'abridgedDirectory'>,
  version: string,
  file: Exclude<LlmsFile, 'llms'>,
): { include: string[]; exclude?: string[] } {
  const include = [`${version}/**`];
  return file === 'llms-small'
    ? { include, exclude: [`!${version}/${config.abridgedDirectory}/**`] }
    : { include };
}

/** Make root-relative Markdown links absolute, as llms.txt links should be. */
export function absoluteMarkdownLinks(markdown: string, site: URL): string {
  return markdown.replace(
    /(\]\()(\/(?!\/)[^)\s]*)\)/g,
    (_whole, prefix: string, href: string) =>
      `${prefix}${new URL(href, site).href})`,
  );
}

/**
 * The `llms.txt` index of one version. Links are root-relative so the caller
 * can keep them inside the version before making them absolute.
 */
export function llmsIndex(
  config: VersionedLlmsConfig,
  docs: DocsVersions,
  version: string,
): string {
  const base = `/${version}`;
  const sets = versionSets(config, docs.pages[version] ?? []);
  const segments = [
    `# ${config.title} ${version}`,
    `> ${config.description}`,
    config.details[version] ?? '',
    '## Documentation Sets',
    [
      `- [Abridged documentation](${base}/llms-small.txt): a compact version of the ${version} documentation for ${config.title}, with non-essential content removed`,
      `- [Complete documentation](${base}/llms-full.txt): the full ${version} documentation for ${config.title}`,
      ...sets.map(
        (set) =>
          `- [${set.label}](${base}/_llms-txt/${set.slug}.txt): ${set.description}`,
      ),
    ].join('\n'),
    '## Versions',
    docs.versions
      .map((candidate) => {
        const notes = [
          candidate === version ? 'this file' : '',
          candidate === docs.defaultVersion
            ? 'the latest release on npm, also served without a version prefix'
            : '',
          candidate === DEV_VERSION
            ? 'built from main, can describe unreleased APIs'
            : '',
        ].filter(Boolean);
        return `- [${candidate}](/${candidate}/llms.txt)${notes.length ? `: ${notes.join('; ')}` : ''}`;
      })
      .join('\n'),
    '## Notes',
    [
      `- Every file and page link here stays inside the ${version} documentation`,
      '- The content is automatically generated from the same source as the official documentation',
    ].join('\n'),
  ];
  if (config.optionalLinks.length > 0) {
    segments.push(
      '## Optional',
      config.optionalLinks
        .map(
          (link) =>
            `- [${link.label}](${link.url})${link.description ? `: ${link.description}` : ''}`,
        )
        .join('\n'),
    );
  }
  return `${segments.filter(Boolean).join('\n\n')}\n`;
}
