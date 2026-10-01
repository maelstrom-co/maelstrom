import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import { installPageDiagnostics } from './page-diagnostics.ts';

test('sanitizes synthetic document, console, error, and request diagnostics before attachment', async ({
  page,
}, testInfo) => {
  const captureDiagnostics = installPageDiagnostics(page, testInfo);
  await page.route('http://localhost/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/request/token/synthetic-failed-path-token') {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: pathname === '/api/session/path-secret-value' ? 401 : 200,
      contentType: 'text/html',
      body: `<!doctype html><title>synthetic diagnostics</title><main>{"token":"synthetic-first synthetic-second Bearer synthetic-tail"}</main>`,
    });
  });
  await page.goto(
    'http://localhost/sessions/path-secret-value/summary?token=synthetic-location-query',
  );
  const failedRequest = page.waitForEvent('requestfailed', {
    predicate: (request) =>
      new URL(request.url()).pathname.startsWith('/api/request/token/'),
  });
  const pageError = page.waitForEvent('pageerror');
  await page.evaluate(async () => {
    console.error('console {"api_key":"synthetic-console-value"}');
    setTimeout(() => {
      throw new Error('{"access_token":"synthetic-page-error-value"}');
    }, 0);
    await Promise.all([
      fetch(
        '/api/request/token/synthetic-failed-path-token?api_key=synthetic-failed-query-token',
      ).catch(() => {}),
      fetch('/api/session/path-secret-value?token=synthetic-response-query'),
    ]);
  });
  await Promise.all([failedRequest, pageError]);
  await captureDiagnostics(
    'synthetic-attachment-probe',
    new Error('{"authorization":"Bearer synthetic-error-bearer"}'),
  );

  const attachment = testInfo.attachments.find(
    ({ name }) => name === 'voice-page-diagnostics.json',
  );
  assert.ok(attachment?.body, 'diagnostic JSON attachment was captured');
  const serialized = attachment.body.toString('utf8');
  for (const secret of [
    'path-secret-value',
    'synthetic-first',
    'synthetic-second',
    'synthetic-tail',
    'synthetic-location-query',
    'synthetic-console-value',
    'synthetic-page-error-value',
    'synthetic-failed-path-token',
    'synthetic-failed-query-token',
    'synthetic-response-query',
    'synthetic-error-bearer',
  ])
    assert.equal(serialized.includes(secret), false, `${secret} was attached`);

  const diagnostic = JSON.parse(serialized) as {
    document: { path: string };
    consoleErrors: string[];
    pageErrors: string[];
    failedRequests: string[];
    badResponses: string[];
  };
  assert.match(diagnostic.document.path, /\/sessions\/\[REDACTED\]\/summary/);
  assert.ok(
    diagnostic.consoleErrors.some((message) => message.includes('[REDACTED]')),
  );
  assert.ok(
    diagnostic.pageErrors.some((message) => message.includes('[REDACTED]')),
  );
  assert.ok(
    diagnostic.failedRequests.some(
      (message) =>
        message.startsWith('GET /api/request/') &&
        message.includes('[REDACTED]'),
    ),
    JSON.stringify(diagnostic.failedRequests),
  );
  assert.ok(
    diagnostic.badResponses.some((message) =>
      message.includes('/api/session/[REDACTED]'),
    ),
  );
});
