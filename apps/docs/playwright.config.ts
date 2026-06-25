import { defineConfig, devices } from '@playwright/test';

// Smoke coverage for the interactive architecture diagram. Runs against
// `astro dev` on purpose: the diagram once rendered in the production build but
// broke under dev (framework-island preamble), and dev is what contributors run.
//
// Note: this config intentionally avoids importing `@nx/devkit` / the Nx preset.
// Playwright loads the config in a process where Nx's native binding fails under
// the Bun runtime; the `@nx/playwright/plugin` still infers the `e2e` target.
const baseURL = process.env['BASE_URL'] || 'http://localhost:4322';

export default defineConfig({
  testDir: './e2e',
  outputDir: './dist/.playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bunx astro dev --port 4322',
    url: 'http://localhost:4322/understanding/architecture/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
