/** The continuously updated version built from main. */
export const DEV_VERSION = 'dev';

/** The page each version opens on when no matching page exists. */
export const VERSION_LANDING_PAGE = 'getting-started/introduction';

// Released folders are named by minor before 1.0 (`0.2`) and by major after.
const RELEASED_VERSION = /^\d+(?:\.\d+)?$/;

/** Versions discovered from the content folders, with the build's default. */
export interface DocsVersions {
  /** `dev` first, then released versions from newest to oldest. */
  versions: string[];
  /** The version bare paths and the picker default to: the npm release. */
  defaultVersion: string;
  /** Page slugs relative to each version folder, without slashes. */
  pages: Record<string, string[]>;
}

/** One entry of the version picker. */
export interface VersionOption {
  version: string;
  label: string;
  href: string;
  current: boolean;
}

// github-slugger, which Astro applies to entry ids, removes these on ASCII names.
const SLUG_REMOVED = /[!-,./:-@[-^`{-~]/g;

/**
 * Astro's default entry id with the version folder kept verbatim, so `0.2/`
 * is served at `/0.2/` instead of being slugified to `/02/`.
 */
export function docsEntryId(entry: string, slug?: unknown): string {
  if (typeof slug === 'string' && slug) return slug;
  return entry
    .replace(/\.[^./]+$/, '')
    .split('/')
    .map((segment, index) =>
      index === 0 && isVersionFolder(segment)
        ? segment
        : segment.toLowerCase().replace(SLUG_REMOVED, '').replace(/ /g, '-'),
    )
    .join('/')
    .replace(/\/index$/, '');
}

/** Whether a top-level content folder name denotes a docs version. */
export function isVersionFolder(name: string): boolean {
  return name === DEV_VERSION || RELEASED_VERSION.test(name);
}

/** Order versions as the picker lists them: dev, then newest release first. */
export function sortVersions(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => {
    if (a === DEV_VERSION) return -1;
    if (b === DEV_VERSION) return 1;
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const difference = (right[i] ?? 0) - (left[i] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
}

/**
 * Pick the version bare paths serve. The newest released folder is the latest
 * non-prerelease on npm because folders are only created by a release
 * snapshot. `DOCS_DEFAULT_VERSION` overrides it for a build.
 */
export function pickDefaultVersion(
  versions: readonly string[],
  override?: string,
): string {
  if (override) {
    if (!versions.includes(override)) {
      throw new Error(
        `DOCS_DEFAULT_VERSION=${override} has no folder in src/content/docs; found ${versions.join(', ')}.`,
      );
    }
    return override;
  }
  return versions.find((version) => version !== DEV_VERSION) ?? DEV_VERSION;
}

/** Split a slug or pathname into its version and the version-relative rest. */
export function splitVersion(
  path: string,
  versions: readonly string[],
): { version: string; rest: string } | undefined {
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  const [first = '', ...rest] = trimmed.split('/');
  if (!versions.includes(first)) return undefined;
  return { version: first, rest: rest.join('/') };
}

/** The URL of a version-relative page slug. */
export function versionHref(version: string, rest: string): string {
  return rest ? `/${version}/${rest}/` : `/${version}/`;
}

/** The page a version opens on. */
export function versionLanding(
  docs: DocsVersions,
  version: string,
): string | undefined {
  const pages = docs.pages[version] ?? [];
  if (pages.includes(VERSION_LANDING_PAGE)) return VERSION_LANDING_PAGE;
  return pages[0];
}

/**
 * Build the picker entries for a page. Each version links to the same page
 * when that version has it, otherwise to the version's landing page.
 */
export function versionOptions(
  docs: DocsVersions,
  slug: string,
): VersionOption[] {
  const located = splitVersion(slug, docs.versions);
  const current = located?.version ?? docs.defaultVersion;
  const rest = located?.rest ?? slug.replace(/^\/+|\/+$/g, '');
  return docs.versions.map((version) => {
    const pages = docs.pages[version] ?? [];
    const target = pages.includes(rest) ? rest : versionLanding(docs, version);
    return {
      version,
      label: version === docs.defaultVersion ? `${version} (latest)` : version,
      href: versionHref(version, target ?? ''),
      current: version === current,
    };
  });
}

/**
 * Resolve an unversioned path to the versioned page that serves it: the
 * default version when it has the page, otherwise dev, otherwise any version.
 */
export function bareTarget(
  rest: string,
  versions: readonly string[],
  defaultVersion: string,
  hasPage: (version: string, rest: string) => boolean,
): string | undefined {
  const order = [
    defaultVersion,
    DEV_VERSION,
    ...versions.filter((v) => v !== defaultVersion && v !== DEV_VERSION),
  ];
  const version = order.find(
    (candidate) => versions.includes(candidate) && hasPage(candidate, rest),
  );
  return version ? versionHref(version, rest) : undefined;
}

const ANCHOR_HREF = /(<a\b[^>]*?\shref=")(\/[^"]*)"/g;

/**
 * Keep root-relative links on a versioned page inside that version. Content
 * is authored with unversioned links (`/guides/...`) so a snapshot is a plain
 * copy; a link stays as written when the version has no such page.
 */
export function rewriteVersionLinks(
  html: string,
  version: string,
  docs: Pick<DocsVersions, 'versions' | 'pages'>,
): string {
  const pages = new Set(docs.pages[version] ?? []);
  return html.replace(ANCHOR_HREF, (whole, prefix: string, href: string) => {
    if (href.startsWith('//')) return whole;
    const match = /^([^?#]*)(.*)$/.exec(href);
    const rest = (match?.[1] ?? '').replace(/^\/+|\/+$/g, '');
    if (!rest || splitVersion(rest, docs.versions)) return whole;
    if (!pages.has(rest)) return whole;
    return `${prefix}${versionHref(version, rest)}${match?.[2] ?? ''}"`;
  });
}
