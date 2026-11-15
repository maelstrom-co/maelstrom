import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

const WS_PORT = 4391;
const CLIENT_PORT = 4390;

loadRepoRootEnv();

const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';

export default defineConfig({
  testDir: './e2e/agent-live',
  testMatch: '**/*.live.e2e.ts',

  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 60_000 },

  outputDir: './dist/agent-live-results',

  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1_440, height: 900 },
      },
    },
  ],
  // Without a key the spec skips, so no server is started.
  webServer: apiKey
    ? [
        {
          command: 'bun --env-file=../../.env run src/server/ws-server.ts',
          url: `http://127.0.0.1:${WS_PORT}/`,
          env: {
            OPENAI_API_KEY: apiKey,
            WS_PORT: String(WS_PORT),
            MAELSTROM_AGENT: 'on',
          },
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
        },
        {
          command: `bunx vite --host 127.0.0.1 --port ${CLIENT_PORT} --strictPort`,
          url: `http://127.0.0.1:${CLIENT_PORT}/`,
          env: {
            // vite.config.mjs derives the browser key mode from this key,
            // so the server key is used whenever it is present.
            OPENAI_API_KEY: apiKey,
            VITE_BROWSER_KEY_MODE: '0',
            // The demo connector appends the `/ws` path itself.
            VITE_WS_URL: `ws://127.0.0.1:${WS_PORT}`,
          },
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: 'pipe',
        },
      ]
    : undefined,
});

// An explicitly empty OPENAI_API_KEY must not be refilled from the file, so
// `OPENAI_API_KEY= ...` proves the skip even when the repo-root .env has a key.
function loadRepoRootEnv(): void {
  if (process.env.OPENAI_API_KEY !== undefined) return;
  const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}
