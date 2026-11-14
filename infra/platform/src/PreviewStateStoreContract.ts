/** Dedicated backend for this repository's preview state in the shared account. */
export const OSS_PREVIEW_STATE_STORE_WORKER =
  'alchemy-state-store-maelstrom-oss-preview';

/** Capability marker required before a reviewed source may use the isolated store. */
export const PREVIEW_STATE_STORE_CAPABILITY = 'maelstromPreviewStateStore';

/** Trusted manual workflow that may issue an isolation receipt. */
export const PREVIEW_ISOLATION_WORKFLOW =
  '.github/workflows/preview-state-isolation.yml';

/** State namespaces owned by this repository's Alchemy PR previews. */
export const OSS_PREVIEW_STACKS = [
  { stack: 'MaelstromDemoPreview', workerPrefix: 'maelstrom-playground' },
  { stack: 'MaelstromWwwPreview', workerPrefix: 'maelstrom-www' },
  { stack: 'MaelstromDocsPreview', workerPrefix: 'maelstrom-docs' },
] as const;

/** Canonical stage boundary accepted by the preview entrypoints. */
export const OSS_PREVIEW_STAGE_PATTERN = /^pr-[1-9]\d*$/;
