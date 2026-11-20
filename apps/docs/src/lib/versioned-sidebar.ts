import type { StarlightUserConfig } from '@astrojs/starlight/types';

type SidebarItem = NonNullable<StarlightUserConfig['sidebar']>[number];

/**
 * Point a sidebar written with unversioned slugs at one version folder. When
 * `pages` is given, entries the version does not have are dropped so a frozen
 * version keeps building after main adds pages.
 */
export function versionSidebar(
  items: SidebarItem[],
  version: string,
  pages?: ReadonlySet<string>,
): SidebarItem[] {
  const result: SidebarItem[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      if (!pages || pages.has(item)) result.push(`${version}/${item}`);
      continue;
    }
    if ('slug' in item) {
      if (!pages || pages.has(item.slug)) {
        result.push({ ...item, slug: `${version}/${item.slug}` });
      }
      continue;
    }
    if ('items' in item) {
      // starlight-typedoc finds its placeholder group by a symbol label.
      if (typeof item.label !== 'string') {
        result.push(item);
        continue;
      }
      const children = versionSidebar(item.items, version, pages);
      if (children.length > 0) result.push({ ...item, items: children });
      continue;
    }
    if ('autogenerate' in item) {
      result.push({
        ...item,
        autogenerate: {
          ...item.autogenerate,
          directory: `${version}/${item.autogenerate.directory}`,
        },
      });
      continue;
    }
    result.push(item);
  }
  return result;
}
