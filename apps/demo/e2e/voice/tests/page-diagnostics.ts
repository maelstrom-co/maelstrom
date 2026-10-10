import type { Page, TestInfo } from '@playwright/test';
import {
  sanitizeDiagnosticPathname,
  sanitizeDiagnosticText,
} from './diagnostic-sanitizer.ts';

export function installPageDiagnostics(page: Page, testInfo: TestInfo) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];
  const retainLatest = (entries: string[], entry: string) => {
    entries.push(entry);
    if (entries.length > 20) entries.shift();
  };
  page.on('pageerror', (error) =>
    retainLatest(
      pageErrors,
      sanitizeDiagnosticText(`${error.name}: ${error.message}`),
    ),
  );
  page.on('console', (message) => {
    if (message.type() === 'error')
      retainLatest(consoleErrors, sanitizeDiagnosticText(message.text()));
  });
  page.on('requestfailed', (request) =>
    retainLatest(
      failedRequests,
      `${request.method()} ${sanitizeDiagnosticPathname(request.url())}: ${sanitizeDiagnosticText(request.failure()?.errorText ?? 'request failed')}`,
    ),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      retainLatest(
        badResponses,
        `${response.status()} ${sanitizeDiagnosticPathname(response.url())}`,
      );
  });
  return async (stage: string, error?: unknown) => {
    const documentState = await page
      .evaluate(() => {
        const textOf = (button: HTMLButtonElement) =>
          button.textContent?.trim() ?? '';
        return {
          path: window.location.pathname,
          title: document.title,
          readyState: document.readyState,
          bodyText: document.body?.innerText.slice(0, 4_000) ?? '',
          voiceOrbCount: document.querySelectorAll('button.voice-orb').length,
          startButtonCount: [...document.querySelectorAll('button')].filter(
            (button) => textOf(button) === 'Start interactive demo',
          ).length,
          keyRequiredStatusCount: document.querySelectorAll(
            '[role="status"][aria-label*="key required" i]',
          ).length,
          keyInputCount: document.querySelectorAll('#playground-api-key')
            .length,
          dialogCount: document.querySelectorAll('[role="dialog"]').length,
          captionsCount: document.querySelectorAll('[data-testid="captions"]')
            .length,
        };
      })
      .catch((cause: unknown) => ({
        path: null,
        title: null,
        readyState: null,
        bodyText: null,
        voiceOrbCount: null,
        startButtonCount: null,
        keyRequiredStatusCount: null,
        keyInputCount: null,
        dialogCount: null,
        captionsCount: null,
        documentReadError: sanitizeDiagnosticText(String(cause)),
      }));
    await testInfo.attach('voice-page-diagnostics.json', {
      body: JSON.stringify(
        {
          stage: sanitizeDiagnosticText(stage),
          error:
            error === undefined
              ? null
              : sanitizeDiagnosticText(
                  error instanceof Error
                    ? `${error.name}: ${error.message}`
                    : String(error),
                ),
          document: {
            ...documentState,
            path:
              documentState.path === null
                ? null
                : sanitizeDiagnosticPathname(documentState.path),
            bodyText:
              documentState.bodyText === null
                ? null
                : sanitizeDiagnosticText(documentState.bodyText),
            title:
              documentState.title === null
                ? null
                : sanitizeDiagnosticText(documentState.title),
          },
          pageErrors: pageErrors.slice(-20),
          consoleErrors: consoleErrors.slice(-20),
          failedRequests: failedRequests.slice(-20),
          badResponses: badResponses.slice(-20),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  };
}
