import type { StarlightRouteData } from '@astrojs/starlight/route-data';

type SidebarEntry = StarlightRouteData['sidebar'][number];
type SidebarLink = Extract<SidebarEntry, { type: 'link' }>;

/**
 * One version's sidebar with the link for `pathname` marked current.
 * Starlight marks only the first link to a page, which sits in another
 * version's group when every version lists an unversioned page. The entries
 * are copied because Starlight caches and reuses them between pages.
 */
export function withCurrentEntry(
  entries: SidebarEntry[],
  pathname: string,
): SidebarEntry[] {
  if (sidebarLinks(entries).some((link) => link.isCurrent)) return entries;
  const path = trimSlashes(pathname);
  let marked = false;
  const mark = (list: SidebarEntry[]): SidebarEntry[] =>
    list.map((entry) => {
      if (entry.type === 'group') {
        return { ...entry, entries: mark(entry.entries) };
      }
      if (marked || trimSlashes(entry.href) !== path) return entry;
      marked = true;
      return { ...entry, isCurrent: true };
    });
  return mark(entries);
}

/** The links before and after the current link, in sidebar order. */
export function sidebarNeighbors(entries: SidebarEntry[]): {
  prev: SidebarLink | undefined;
  next: SidebarLink | undefined;
} {
  const links = sidebarLinks(entries);
  const index = links.findIndex((link) => link.isCurrent);
  if (index === -1) return { prev: undefined, next: undefined };
  return { prev: links[index - 1], next: links[index + 1] };
}

/**
 * A neighbor from the page's own version under the label its frontmatter
 * `prev` or `next` sets, when it sets one.
 */
export function withFrontmatterLabel(
  link: SidebarLink | undefined,
  override: unknown,
): SidebarLink | undefined {
  if (!link) return undefined;
  const label =
    typeof override === 'string'
      ? override
      : typeof override === 'object' && override !== null && 'label' in override
        ? override.label
        : undefined;
  return typeof label === 'string' ? { ...link, label } : link;
}

function sidebarLinks(entries: SidebarEntry[]): SidebarLink[] {
  return entries.flatMap((entry) =>
    entry.type === 'group' ? sidebarLinks(entry.entries) : [entry],
  );
}

function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
