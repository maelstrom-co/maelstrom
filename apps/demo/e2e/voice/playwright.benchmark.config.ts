import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: [
    '**/voice-benchmark.live.e2e.ts',
    '**/shared-audio-capture.live.e2e.ts',
  ],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: './dist/voice-benchmark-results',
  use: {
    baseURL: process.env.MAELSTROM_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    channel: 'chromium',
    headless: true,
    permissions: ['microphone'],
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: { ignoreDefaultArgs: ['--mute-audio'] },
  },
});
