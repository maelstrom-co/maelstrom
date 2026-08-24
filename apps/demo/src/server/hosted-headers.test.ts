import { describe, expect, it } from 'vitest';
import {
  headersForPath,
  parseHeaderRules,
  pathMatches,
  resolveClientFile,
} from './hosted-headers';

describe('hosted e2e header stand-in', () => {
  it('applies the catch-all CSP and the fingerprinted asset cache policy', () => {
    const rules = parseHeaderRules(`
/*
  Content-Security-Policy: default-src 'self'; connect-src wss://*.maelstrom-dev.workers.dev
  X-Content-Type-Options: nosniff

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/vad-web/*
  Cache-Control: public, max-age=3600
`);

    const document = headersForPath('/', rules);
    expect(document.get('Content-Security-Policy')).toContain(
      'wss://*.maelstrom-dev.workers.dev',
    );
    expect(document.get('Cache-Control')).toBeNull();

    const asset = headersForPath('/assets/index-abc.js', rules);
    expect(asset.get('Cache-Control')).toContain('max-age=31536000');
    expect(asset.get('Content-Security-Policy')).toContain(
      "default-src 'self'",
    );
  });

  it('rejects path traversal before touching the client tree', () => {
    expect(pathMatches('/assets/index.js', '/assets/*')).toBe(true);
    expect(
      resolveClientFile('/../package.json', '/tmp/client'),
    ).toBeUndefined();
    expect(resolveClientFile('/%2e%2e/package.json', '/tmp/client')).toBe(
      undefined,
    );
  });
});
