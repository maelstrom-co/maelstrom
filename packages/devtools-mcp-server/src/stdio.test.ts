import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true });
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('the compiled stdio command supports discovery and private pairing cleanup over %s', async (protocol) => {
  const dir = await mkdtemp(join(tmpdir(), 'maelstrom-mcp-'));
  directories.push(dir);
  const file = join(dir, 'pairing.json');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [
      join(import.meta.dirname, '../dist/cli.js'),
      '--origin',
      'http://localhost:4321',
      '--pairing-file',
      file,
    ],
    stderr: 'pipe',
  });
  const client = new Client(
    { name: 'stdio-test', version: '1' },
    {
      versionNegotiation: {
        mode: protocol === 'legacy' ? 'legacy' : { pin: protocol },
      },
    },
  );
  try {
    await client.connect(transport);
    expect(client.getProtocolEra()).toBe(
      protocol === 'legacy' ? 'legacy' : 'modern',
    );
    if (protocol !== 'legacy')
      expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getInstructions()).toContain('one recovery attempt');
    expect(client.getInstructions()).toContain('untrusted data');
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'get_request',
      'list_apps',
      'list_targets',
      'query_events',
    ]);
    expect(
      (await client.callTool({ name: 'list_targets', arguments: {} }))
        .structuredContent,
    ).toEqual({ targets: [] });
    const pairing = JSON.parse(await readFile(file, 'utf8'));
    expect(pairing.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/devtools$/);
    expect(pairing.token).toMatch(/^[a-f0-9]{64}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await client.close();
  }
  await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a startup signal removes a pairing file before stdio initialization finishes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-mcp-signal-'));
  directories.push(directory);
  const file = join(directory, 'pairing.json');
  const preload = join(directory, 'slow-stat.mjs');
  await Bun.write(
    preload,
    `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const open=fs.open; fs.open=async(...args)=>{const file=await open(...args);const stat=file.stat.bind(file);file.stat=async()=>{await new Promise(resolve=>setTimeout(resolve,500));return stat();};return file;};syncBuiltinESMExports();`,
  );
  const child = Bun.spawn(
    [
      'node',
      '--import',
      preload,
      join(import.meta.dirname, '../dist/cli.js'),
      '--origin',
      'http://localhost:4321',
      '--pairing-file',
      file,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(await Bun.file(file).exists()))
      await Bun.sleep(5);
    expect(await Bun.file(file).exists()).toBe(true);
    child.kill('SIGTERM');
    await child.exited;
    expect(await Bun.file(file).exists()).toBe(false);
  } finally {
    child.kill();
    await child.exited;
  }
});

test.each([
  'open',
  'closed',
] as const)('a broken output pipe releases owned resources with stdin %s', async (stdin) => {
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-mcp-output-'));
  directories.push(directory);
  const file = join(directory, 'pairing.json');
  const child = spawn('node', [
    join(import.meta.dirname, '../dist/cli.js'),
    '--origin',
    'http://localhost:4321',
    '--pairing-file',
    file,
  ]);
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.on('error', () => {});
  try {
    const readyDeadline = Date.now() + 5000;
    while (!stderr.includes('MCP ready') && Date.now() < readyDeadline)
      await Bun.sleep(5);
    expect(stderr).toContain('MCP ready');
    const { endpoint } = JSON.parse(await readFile(file, 'utf8'));
    child.stdout.destroy();
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'broken-output-test', version: '1' },
        },
      })}\n`,
    );
    const errorDeadline = Date.now() + 2000;
    while (!stderr.includes('protocol error') && Date.now() < errorDeadline)
      await Bun.sleep(5);
    expect(stderr).toContain('protocol error');
    if (stdin === 'closed') child.stdin.end();
    const exitDeadline = Date.now() + 2000;
    while (child.exitCode === null && Date.now() < exitDeadline)
      await Bun.sleep(5);
    expect(child.exitCode).toBe(0);
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fetch(endpoint.replace('ws:', 'http:'), {
        signal: AbortSignal.timeout(500),
      }),
    ).rejects.toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await exited;
  }
}, 10000);
