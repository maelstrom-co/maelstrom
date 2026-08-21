export const production = {
  stage: 'prod',
  zone: {
    id: '4df25ea08d364f19471be7a179ce9f02',
    name: 'maelstrom-ai.co',
    type: 'full',
    paused: false,
    vanityNameServers: [],
  },
  waitlist: {
    databaseName: 'maelstrom-waitlist',
    sendingDomain: 'notifications.maelstrom-ai.co',
    turnstile: {
      name: 'Maelstrom waitlist',
      sitekey: '0x4AAAAAAEXK9DFwilhX3Cla',
      domains: [
        'maelstrom-ai.co',
        'www.maelstrom-ai.co',
        'localhost',
        '127.0.0.1',
      ],
      mode: 'managed',
      action: 'turnstile-spin-v1',
    },
    rateLimit: {
      description: 'Rate limit waitlist signup',
      path: '/api/waitlist',
      periodSeconds: 60,
      requestsPerPeriod: 10,
      action: 'managed_challenge',
    },
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
      database: 'WAITLIST_DB',
      email: 'EMAIL',
      images: 'IMAGES',
      turnstileSecret: 'TURNSTILE_SECRET_KEY',
    },
    senderAddress: 'waitlist@notifications.maelstrom-ai.co',
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

export const isStateInspectionStage = (stage: string): boolean =>
  stage === 'placeholder';
