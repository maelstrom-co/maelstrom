export const production = {
  stage: 'prod',
  zone: {
    name: 'maelstrom-ai.co',
    type: 'full',
    paused: false,
    vanityNameServers: [],
  },
  www: {
    workerName: 'www',
    domains: ['maelstrom-ai.co', 'www.maelstrom-ai.co'],
    compatibilityDate: '2026-07-22',
    compatibilityFlags: ['nodejs_compat'],
    main: '../../apps/www/dist/server/entry.mjs',
    assets: '../../apps/www/dist/client',
    bundle: false,
    bindings: {
      images: 'IMAGES',
      resendApiKey: 'RESEND_API_KEY',
      resendSegmentId: 'RESEND_SEGMENT_ID',
    },
    resendSegmentId: '5b0cbb3a-8c80-4a78-b5ff-3fad686af8bb',
  },
  docs: {
    workerName: 'docs',
    domains: ['docs.maelstrom-ai.co'],
    compatibilityDate: '2026-03-30',
    assets: '../../apps/docs/dist',
  },
  demo: {
    workerName: 'maelstrom-playground',
    domains: ['demo.maelstrom-ai.co'],
    compatibilityDate: '2026-07-22',
    main: '../../apps/demo/src/worker/index.ts',
    assets: '../../apps/demo/dist/client',
    notFoundHandling: 'single-page-application',
    runWorkerFirst: ['/ws'],
    durableObject: {
      binding: 'SESSION_DO',
      className: 'SessionDO',
    },
  },
} as const;

export const isProductionStage = (stage: string): boolean =>
  stage === production.stage;
