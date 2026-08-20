const DEFAULT_SOURCE_REF = 'main';
const SAFE_SOURCE_REF = /^[A-Za-z0-9._-]+$/;

/**
 * Selects the repository ref used by generated TypeDoc links.
 *
 * Builders may provide an explicit ref through `DOCS_SOURCE_REF`; otherwise,
 * Cloudflare Workers Builds use `WORKERS_CI_COMMIT_SHA`, followed by GitHub
 * Actions' `GITHUB_SHA`. Metadata-free local builds use the mutable `main`
 * fallback. A selected value must be a single URL-safe path segment; invalid
 * values fail the build instead of producing a malformed URL.
 */
export function resolveDocsSourceRef(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  let source: string;
  let sourceRef: string;
  if (environment.DOCS_SOURCE_REF !== undefined) {
    source = 'DOCS_SOURCE_REF';
    sourceRef = environment.DOCS_SOURCE_REF;
  } else if (environment.WORKERS_CI_COMMIT_SHA !== undefined) {
    source = 'WORKERS_CI_COMMIT_SHA';
    sourceRef = environment.WORKERS_CI_COMMIT_SHA;
  } else if (environment.GITHUB_SHA !== undefined) {
    source = 'GITHUB_SHA';
    sourceRef = environment.GITHUB_SHA;
  } else {
    return DEFAULT_SOURCE_REF;
  }

  if (
    !SAFE_SOURCE_REF.test(sourceRef) ||
    sourceRef === '.' ||
    sourceRef === '..'
  ) {
    throw new Error(`Invalid ${source}: ${JSON.stringify(sourceRef)}`);
  }

  return sourceRef;
}

/**
 * Creates the shared GitHub source template while leaving TypeDoc's
 * repository-relative path and numeric line placeholders intact. The ref must
 * already have passed `resolveDocsSourceRef`; this formatter does not validate
 * independently.
 */
export function createGitHubSourceLinkTemplate(sourceRef: string): string {
  return `https://github.com/maelstrom-co/maelstrom/blob/${sourceRef}/{path}#L{line}`;
}
