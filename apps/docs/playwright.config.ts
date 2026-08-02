import { defineConfig, devices } from '@playwright/test';

// Smoke coverage for the interactive architecture diagram. Runs against
// `astro dev` on purpose: the diagram once rendered in the production build but
// broke under dev (framework-island preamble), and dev is what contributors run.
//
// Note: this config intentionally avoids importing `@nx/devkit` / the Nx preset.
// Playwright loads the config in a process where Nx's native binding fails under
// the Bun runtime; the `@nx/playwright/plugin` still infers the `e2e` target.
const baseURL = process.env.BASE_URL || 'http://localhost:4322';

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
    // Both flags exist to survive Astro 7's dev-server process management.
    //
    // `--ignore-lock`: the lock is keyed on the project root, not the port
    // (`<root>/.astro/dev.json`), so a contributor already running `nx dev docs`
    // on 4321 makes `astro dev --port 4322` abort with "Another astro dev server
    // is already running". `reuseExistingServer` cannot rescue that — it probes
    // 4322, where nothing is listening. Ignoring the lock also means this server
    // writes no lock file, so it can't mislabel the one a real dev server owns.
    command: 'bunx astro dev --port 4322 --ignore-lock',
    // Deliberately not the page under test. Readiness has to prove Astro
    // compiles pages — Astro 7's Rust compiler errors on markup it used to
    // auto-correct, and the architecture page is the only hand-authored
    // `.astro` prose here — but probing that page folds its compile failure
    // into a 120s "webServer exited early" instead of a test failure naming
    // the bad tag. A cheap Starlight page proves the pipeline is up and leaves
    // the architecture compile to the test that can report it.
    //
    // Not `/_astro/status` either: that is Vite middleware, answered ~5s before
    // the first page compiles (measured warm; CI is colder, since the 362
    // generated reference pages are gitignored). It would move that compile out
    // of this 120s budget and into the first test's much smaller one.
    url: 'http://localhost:4322/getting-started/introduction/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // ASTRO_DEV_BACKGROUND: Astro detaches `astro dev` into a background daemon
    // when it detects an AI coding agent (CLAUDECODE, AI_AGENT, …); the
    // foreground process then exits and Playwright aborts with "webServer exited
    // early". Astro reads this variable as `!process.env.ASTRO_DEV_BACKGROUND`,
    // so any non-empty value — the value itself is never compared — suppresses
    // that. Playwright merges this over the inherited env rather than replacing
    // it, so PATH and the rest survive. `--ignore-lock` is rejected while agent
    // detection is active, which is why this must be set alongside it.
    env: { ASTRO_DEV_BACKGROUND: '0' },
  },
});
