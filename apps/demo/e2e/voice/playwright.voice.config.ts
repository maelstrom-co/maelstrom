import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Run against an already-started, voice-enabled local/test Maelstrom app.
// This deliberately does not reuse the hosted launch-readiness stand-in server.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.live.e2e.ts',
  testIgnore: '**/voice-benchmark.live.e2e.ts',
  workers: 1,
  fullyParallel: false,
  retries: 2,
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
    // Credentialed voice pages must not emit browser recordings or screenshots.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { ignoreDefaultArgs: ['--mute-audio'] },
  },
});
