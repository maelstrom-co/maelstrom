import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: './e2e/voice',
  testMatch: '**/*.live.e2e.ts',

  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 30_000 },

  outputDir: './dist/voice-results',

  use: {
    baseURL: process.env.MAELSTROM_BASE_URL || 'http://localhost:3000',

    browserName: 'chromium',
    channel: 'chromium',
    headless: true,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 900 },

    trace: 'off',
    screenshot: 'only-on-failure',

    launchOptions: {
      ignoreDefaultArgs: ['--mute-audio'],
    },
  },
});
