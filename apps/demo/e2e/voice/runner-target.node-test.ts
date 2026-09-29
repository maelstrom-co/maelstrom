import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialNavigationURL, resolveRunnerTarget } from './runner-target.ts';

test('unset and empty base URLs use local routing', () => {
  assert.deepEqual(resolveRunnerTarget(undefined), {
    mode: 'local',
    browserURL: 'http://localhost:3000',
  });
  assert.deepEqual(resolveRunnerTarget(''), {
    mode: 'local',
    browserURL: 'http://localhost:3000',
  });
  assert.equal(initialNavigationURL(undefined), 'http://localhost:3000');
  assert.equal(initialNavigationURL(''), 'http://localhost:3000');
});

test('configured HTTP(S) URL selects remote routing and omits query values from metadata', () => {
  assert.deepEqual(
    resolveRunnerTarget('https://demo.maelstrom-ai.co/path?mode=voice'),
    {
      mode: 'remote',
      browserURL: 'https://demo.maelstrom-ai.co/path?mode=voice',
      readinessURL: 'https://demo.maelstrom-ai.co/path?mode=voice',
      metadataURL: 'https://demo.maelstrom-ai.co/path',
    },
  );
});

test('initial navigation retains the resolved remote path and query', () => {
  const configured = 'https://demo.maelstrom-ai.co/nested/app?mode=voice';
  assert.equal(initialNavigationURL(configured), configured);
});

test('rejects unsupported schemes and URLs containing credentials', () => {
  assert.throws(() => resolveRunnerTarget('file:///tmp/app'), /HTTP\(S\)/);
  assert.throws(
    () => resolveRunnerTarget('https://user:password@example.com'),
    /must not contain credentials/,
  );
});
