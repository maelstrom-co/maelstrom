import { defineConfig, devices } from '@playwright/test';

// www is entirely hand-authored .astro, which makes it the app most exposed to
// Astro 7's `compressHTML: 'jsx'` whitespace rule — and it had no rendered-output
// coverage at all. Runs against `astro dev` (the Cloudflare adapter is dropped
// for the dev server in astro.config.ts, so dev boots without workerd).
//
// Note: this config intentionally avoids importing `@nx/devkit` / the Nx preset.
// Playwright loads the config in a process where Nx's native binding fails under
// the Bun runtime; the `@nx/playwright/plugin` still infers the `e2e` target.
const baseURL = process.env.BASE_URL || 'http://localhost:4323';

export default defineConfig({
  testDir: './e2e',
  outputDir: './dist/.playwright',
  // Tests in blog.spec.ts build isolated Astro apps; running those builds in
  // parallel collides on Astro's fixed inspector port (127.0.0.1:9229).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `--ignore-lock`: Astro's dev lock is keyed on the project root, not the
    // port, so a contributor already running `nx dev www` would otherwise make
    // this abort with "Another astro dev server is already running" — and
    // `reuseExistingServer` cannot rescue it, since it probes 4323 only.
    command: 'bunx astro dev --port 4323 --ignore-lock',
    url: 'http://localhost:4323/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Astro detaches `astro dev` into a background daemon when it detects an AI
    // coding agent; the foreground process exits and Playwright aborts with
    // "webServer exited early". Astro reads this as
    // `!process.env.ASTRO_DEV_BACKGROUND`, so any non-empty value suppresses it
    // (the value is never compared). Also required for `--ignore-lock`, which
    // Astro rejects while agent detection is active.
    env: { ASTRO_DEV_BACKGROUND: '0', WWW_E2E_FIXTURES: '1' },
  },
});
