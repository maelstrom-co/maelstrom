import { defineConfig } from '@playwright/test';

// Run against an already-started, voice-enabled local/test Maelstrom app.
// This deliberately does not reuse the hosted launch-readiness stand-in server.
export default defineConfig({
  testDir: './tests',
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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { ignoreDefaultArgs: ['--mute-audio'] },
  },
});
