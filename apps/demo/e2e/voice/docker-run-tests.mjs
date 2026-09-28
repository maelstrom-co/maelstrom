import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardPort, checkPort } from './forward.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const upstream = process.env.MAELSTROM_HOST || 'host.docker.internal';
const forwards = [];
let child;
let signalCode;
let stopTimer;
const shutdown = signal => {
  signalCode = signal === 'SIGINT' ? 130 : 143;
  if (child) {
    child.kill('SIGTERM');
    stopTimer ??= setTimeout(() => child?.kill('SIGKILL'), 3000);
    stopTimer.unref();
  }
};
const sigint = () => shutdown('SIGINT');
const sigterm = () => shutdown('SIGTERM');
process.on('SIGINT', sigint);
process.on('SIGTERM', sigterm);

try {
  await access(join(root, 'e2e/voice/audio/only-tasks.wav')).catch(() => {
    throw new Error('Missing only-tasks.wav. Mount your prepared fixture directory at /work/maelstrom/e2e/voice/audio (read-only).');
  });
  if (!process.env.PULSE_SERVER) throw new Error('Private PulseAudio is missing; retain the image entrypoint.');
  for (const port of [3000, 3001]) {
    if (signalCode) throw new Error('Interrupted');
    await checkPort(upstream, port);
    forwards.push(await forwardPort({ host: upstream, targetPort: port }));
    // Chromium may resolve localhost to IPv6 before IPv4. Both remain loopback-only.
    try {
      forwards.push(await forwardPort({ host: upstream, targetPort: port, bind: '::1' }));
    } catch (error) {
      if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) throw error;
    }
  }
  const response = await fetch('http://localhost:3000/', { signal: AbortSignal.timeout(15000) });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Maelstrom HTTP readiness failed: ${response.status}`);
  const pkg = JSON.parse(await readFile(join(root, 'node_modules/@playwright/test/package.json'), 'utf8'));
  await mkdir('/work/artifacts', { recursive: true });
  await writeFile('/work/artifacts/runner.json', JSON.stringify({
    node: process.version, architecture: process.arch, playwright: pkg.version,
    upstream, browserURL: 'http://localhost:3000', checkedAt: new Date().toISOString(),
  }, null, 2));
  console.log('Host app reachable; running Chromium, microphone injection and reply recording in Docker.');
  if (signalCode) throw new Error('Interrupted');
  child = spawn(process.execPath, [
    join(root, 'node_modules/@playwright/test/cli.js'),
    'test', '--config', join(root, 'playwright.voice.config.ts'),
    '--output', '/work/artifacts/playwright', '--reporter=line,html',
    ...process.argv.slice(2),
  ], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, MAELSTROM_BASE_URL: 'http://localhost:3000' },
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = signalCode || code;
} catch (error) {
  console.error(error.message);
  process.exitCode = signalCode || 1;
} finally {
  if (stopTimer) clearTimeout(stopTimer);
  process.removeListener('SIGINT', sigint);
  process.removeListener('SIGTERM', sigterm);
  await Promise.all(forwards.map(forward => forward.close()));
}
