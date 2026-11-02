import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('bundled hosts identify the MCP package even when their own version differs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-mcp-bundled-'));
  const packageRoot = resolve(import.meta.dirname, '..');
  const metadata = await Bun.file(join(packageRoot, 'package.json')).json();
  const hostVersion = '9.8.7';
  expect(metadata.version).not.toBe(hostVersion);
  try {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name: 'consumer-host-fixture',
        version: hostVersion,
        type: 'module',
      }),
    );
    await symlink(
      join(packageRoot, 'node_modules'),
      join(directory, 'node_modules'),
      'junction',
    );
    const entry = join(directory, 'host.mjs');
    await writeFile(
      entry,
      `import assert from 'node:assert/strict';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDevtoolsMcpServer } from ${JSON.stringify(join(packageRoot, 'dist/index.js'))};
const host = await createDevtoolsMcpServer({ origin: 'http://localhost:4321' });
try {
  for (const protocol of ['legacy', '2026-07-28']) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = serveStdio(() => host.createServer(), { transport: a });
    const client = new Client({ name: 'bundled-host-test', version: '1' }, {
      versionNegotiation: { mode: protocol === 'legacy' ? 'legacy' : { pin: protocol } },
    });
    try {
      await client.connect(b);
      assert.equal(client.getServerVersion().version, process.argv[2]);
      assert.equal(client.getServerVersion().name, 'maelstrom-devtools');
      assert.equal(client.getProtocolEra(), protocol === 'legacy' ? 'legacy' : 'modern');
    } finally { await client.close(); await server.close(); }
  }
} finally { await host.close(); }
`,
    );
    const build = await Bun.build({
      entrypoints: [entry],
      outdir: join(directory, 'dist'),
      target: 'node',
      format: 'esm',
      external: ['@modelcontextprotocol/*', '@maelstrom-co/*', 'ws', 'zod'],
    });
    expect(build.success, String(build.logs)).toBe(true);
    const output = build.outputs[0];
    expect(output).toBeDefined();
    const result = spawnSync('node', [output!.path, metadata.version], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);
