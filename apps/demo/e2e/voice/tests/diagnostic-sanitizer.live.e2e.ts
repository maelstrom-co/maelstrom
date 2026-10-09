import assert from 'node:assert/strict';
import { test } from '@playwright/test';
import {
  sanitizeDiagnosticPathname,
  sanitizeDiagnosticText,
} from './diagnostic-sanitizer.ts';

test('redacts credential fields and secret URL path segments from diagnostics', () => {
  const diagnostic = {
    document: {
      bodyText: sanitizeDiagnosticText(
        'request /sessions/path-secret-value/summary; response {"token":"synthetic-first synthetic-second Bearer synthetic-tail","api_key":sensitive-value}',
      ),
      path: sanitizeDiagnosticPathname('/sessions/path-secret-value/summary'),
    },
    pageErrors: [
      sanitizeDiagnosticText(
        'authorization: Bearer synthetic-bearer-token; api_key=sk-test-synthetic-key-token',
      ),
    ],
    consoleErrors: [
      sanitizeDiagnosticText(
        'request https://demo.test/private/path-secret-value?token=sensitive-value',
      ),
    ],
    failedRequests: [
      `${sanitizeDiagnosticPathname('https://service.test/v1/grants/path-secret-value?access_token=sensitive-value')}: ${sanitizeDiagnosticText('token=sensitive-value')}`,
    ],
    quotedUrlToken: sanitizeDiagnosticText(
      'request https://demo.test/?token="sensitive-value"',
    ),
    unterminatedUrlToken: sanitizeDiagnosticText(
      'request https://demo.test/?token="sensitive-value',
    ),
    escapedQuoteJson: sanitizeDiagnosticText(
      String.raw`{"token":"synthetic \"quoted\" synthetic-json-value"}`,
    ),
    unterminatedQuoteToken: sanitizeDiagnosticText('token="sensitive-value'),
    basicAuthorization: sanitizeDiagnosticText(
      'Authorization: Basic dXNlcjpwYXNz',
    ),
    tokenAuthorization: sanitizeDiagnosticText(
      'Authorization: Token synthetic-token-prefix synthetic-token-tail',
    ),
    serializedAuthorization: sanitizeDiagnosticText(
      JSON.stringify({
        headers: {
          Authorization: 'Token synthetic-token-prefix synthetic-token-tail',
        },
      }),
    ),
    webSocketUrl: sanitizeDiagnosticText(
      'WebSocket failed: wss://user:password@voice.test/sessions/path-secret-value?token=sensitive-value&api_key=sk-test-synthetic-key-token',
    ),
  };
  assert.match(
    diagnostic.document.bodyText,
    /request \/sessions\/\[REDACTED\]\/summary/,
  );
  assert.equal(
    diagnostic.webSocketUrl,
    'WebSocket failed: /sessions/[REDACTED]',
  );
  assert.equal(diagnostic.escapedQuoteJson, '{"token":"[REDACTED]"}');
  assert.equal(diagnostic.unterminatedQuoteToken, 'token="[REDACTED]"');
  const serialized = JSON.stringify(diagnostic);

  for (const secret of [
    'sensitive-value',
    'synthetic-first',
    'synthetic-second',
    'synthetic-tail',
    'synthetic-json-value',
    'path-secret-value',
    'synthetic-bearer-token',
    'sk-test-synthetic-key-token',
    'dXNlcjpwYXNz',
    'synthetic-token-prefix',
    'synthetic-token-tail',
    'user:password',
  ])
    assert.equal(
      serialized.includes(secret),
      false,
      `${secret} was serialized`,
    );
});
