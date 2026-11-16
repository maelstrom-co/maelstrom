import client from '../../../../packages/client/package.json';
import connectors from '../../../../packages/connectors/package.json';
import engine from '../../../../packages/engine/package.json';
import protocol from '../../../../packages/protocol/package.json';
import react from '../../../../packages/react/package.json';
import { resolveDocsSourceRef } from './docs-source-links';

export const docsSourceRef = resolveDocsSourceRef(process.env);
export const docsRevision =
  process.env.DOCS_SOURCE_REF ||
  process.env.WORKERS_CI_COMMIT_SHA ||
  process.env.GITHUB_SHA
    ? docsSourceRef
    : 'unpinned local build';
export const sdkVersions = [react, client, connectors, protocol, engine]
  .map(({ name, version }) => `${name}@${version}`)
  .join(', ');
