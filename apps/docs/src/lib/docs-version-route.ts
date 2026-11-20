import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import docs from 'virtual:maelstrom/docs-versions';

import { splitVersion } from './docs-versions';

/**
 * The sidebar config holds one top-level group per version. Each page shows
 * only its own version's group, and pagination never crosses into another
 * version. Unversioned pages show the default version.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const version =
    splitVersion(route.id, docs.versions)?.version ?? docs.defaultVersion;
  const group = route.sidebar.find(
    (entry) => entry.type === 'group' && entry.label === version,
  );
  if (group?.type === 'group') route.sidebar = group.entries;
  const otherVersion = (href: string | undefined) =>
    href !== undefined &&
    docs.versions.some(
      (candidate) => candidate !== version && href.startsWith(`/${candidate}/`),
    );
  if (otherVersion(route.pagination.prev?.href)) {
    route.pagination.prev = undefined;
  }
  if (otherVersion(route.pagination.next?.href)) {
    route.pagination.next = undefined;
  }
});
