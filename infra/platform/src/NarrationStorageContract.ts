export const narrationStorage = {
  cache: {
    stack: 'MaelstromNarrationCache',
    stage: 'prod',
    fqn: 'NarrationCache',
    bucket: 'maelstrom-blog-narration-cache',
    entrypoint: 'narration-cache.run.ts',
    account: 'PRODUCTION_ACCOUNT_ID',
    public: false,
  },
  delivery: {
    stack: 'MaelstromNarrationPreviewDelivery',
    stage: 'shared-preview',
    fqn: 'NarrationPreviewDelivery',
    bucket: 'maelstrom-blog-narration-preview',
    entrypoint: 'narration-preview-delivery.run.ts',
    account: 'PREVIEW_ACCOUNT_ID',
    public: true,
  },
} as const;

export type NarrationStorageKind = keyof typeof narrationStorage;
export const narrationProfile = 'narration-ci';
export const narrationInspectionEntrypoint = 'narration-state.run.ts';
export const previewExpiry = 30 * 24 * 60 * 60;
export const previewCors = {
  id: 'public-narration-read',
  allowedMethods: ['GET', 'HEAD'] as ('GET' | 'HEAD')[],
  allowedOrigins: ['*'],
  allowedHeaders: ['range'],
  exposeHeaders: ['accept-ranges', 'content-range', 'content-length'],
  maxAgeSeconds: 300,
};
export const previewLifecycle = {
  id: 'expire-preview-narration',
  prefix: '',
  enabled: true,
  deleteObjectsTransition: {
    condition: { type: 'Age' as const, maxAge: previewExpiry },
  },
};

type Env = Readonly<Record<string, string | undefined>>;

export function narrationAccounts(env: Env = process.env) {
  const production = env.PRODUCTION_ACCOUNT_ID;
  const preview = env.PREVIEW_ACCOUNT_ID;
  if (
    production?.length !== 32 ||
    preview?.length !== 32 ||
    !/^[0-9a-f]{32}$/u.test(production) ||
    !/^[0-9a-f]{32}$/u.test(preview) ||
    production === preview
  ) {
    throw new Error(
      'Narration requires distinct exact production and preview account IDs',
    );
  }
  return { production, preview };
}

export function narrationTarget(
  kind: NarrationStorageKind,
  env: Env = process.env,
) {
  const { production, preview } = narrationAccounts(env);
  return {
    ...narrationStorage[kind],
    accountId: kind === 'cache' ? production : preview,
    stateAccountId: production,
  };
}

export function requireNarrationTarget(
  kind: NarrationStorageKind,
  stage: string,
  env: Env = process.env,
) {
  const target = narrationTarget(kind, env);
  if (
    stage !== target.stage ||
    env.CLOUDFLARE_ACCOUNT_ID !== target.accountId ||
    env.ALCHEMY_PROFILE !== narrationProfile
  ) {
    throw new Error(
      'Narration stack stage, resource account or profile does not match its declared target',
    );
  }
  return target;
}
