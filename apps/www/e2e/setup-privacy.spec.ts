import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { PostHog } from 'posthog-js';

test('real autocapture and replay omit prompt content while bounded setup metrics still work', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  await page.exposeFunction(
    'recordOfflineEvent',
    (event: { event: string; properties?: Record<string, unknown> }) =>
      events.push(event),
  );
  await page.route('**/__posthog_test/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        featureFlags: {},
        featureFlagPayloads: {},
        autocapture_opt_out: false,
        sessionRecording: { endpoint: '/ses/' },
      }),
    }),
  );
  await page.goto('/');
  const copyIntegrationPrompt = page.getByRole('button', {
    name: 'Copy integration prompt',
    exact: true,
  });
  await expect(copyIntegrationPrompt).toBeVisible();
  await page.addScriptTag({
    path: resolve(
      import.meta.dirname,
      '../node_modules/posthog-js/dist/array.full.no-external.js',
    ),
  });
  await page.evaluate(() => {
    const local = window as typeof window & {
      posthog: PostHog;
      recordOfflineEvent: (event: {
        event: string;
        properties?: Record<string, unknown>;
      }) => void;
    };
    local.posthog.init('phc_local_onboarding_test', {
      api_host: `${location.origin}/__posthog_test`,
      persistence: 'memory',
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: true,
      session_recording: { compress_events: false },
      // Synthetic traffic is confined to this local fake project; no event leaves the test.
      opt_out_useragent_filter: true,
      before_send: (event) => {
        local.recordOfflineEvent({
          event: event.event,
          properties: event.properties,
        });
        return null;
      },
    });
    local.posthog.startSessionRecording(true);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const local = window as typeof window & { posthog: PostHog };
        return local.posthog.autocapture?.isEnabled === true;
      }),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const local = window as typeof window & { posthog: PostHog };
        return local.posthog.sessionRecordingStarted();
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    const control = document.createElement('button');
    control.textContent = 'Autocapture control';
    control.dataset.copy = 'AUTOCAPTURE_CONTROL_VALUE';
    document.body.appendChild(control);
  });
  await page
    .getByRole('button', { name: 'Autocapture control', exact: true })
    .click();
  await expect
    .poll(() =>
      events.some(
        (event) =>
          event.event === '$autocapture' &&
          JSON.stringify(event).includes('AUTOCAPTURE_CONTROL_VALUE'),
      ),
    )
    .toBe(true);
  const automaticCount = events.filter(
    (event) => event.event === '$autocapture',
  ).length;
  await copyIntegrationPrompt.click();
  await page.getByText('Read the prompt', { exact: true }).click();
  await expect
    .poll(() => events.some((event) => event.event === 'setup_copied'))
    .toBe(true);
  await expect
    .poll(() => events.some((event) => event.event === '$snapshot'), {
      timeout: 15_000,
    })
    .toBe(true);
  expect(events.filter((event) => event.event === '$autocapture')).toHaveLength(
    automaticCount,
  );
  const serialized = JSON.stringify(events);
  expect(serialized).not.toContain('Help me get started with Maelstrom');
  expect(serialized).not.toContain('Requested authority:');
  expect(
    JSON.stringify(events.filter((event) => event.event === '$snapshot')),
  ).toContain('Maelstrom');
  expect(
    events.find((event) => event.event === 'setup_copied')?.properties,
  ).toMatchObject({ method: 'prompt', source: 'hero' });
});
