import { createServer } from 'vite';

const args = process.argv.slice(2);
const live = args.includes('--live');
const positional = args.filter((arg) => arg !== '--live');
if (positional.length > 1 || positional.some((arg) => !/^\d+$/.test(arg)))
  throw new Error('Usage: bun dev.ts [web-port] [--live]');
const webPort = Number(positional[0] ?? 5173);
const apiPort = Number(process.env.MAELSTROM_API_PORT ?? 3001);
if (
  ![webPort, apiPort].every(
    (port) => Number.isInteger(port) && port > 0 && port <= 65535,
  ) ||
  webPort === apiPort
)
  throw new Error('Use different web and API ports between 1 and 65535.');

// Refuse an occupied API port before proxying requests to another local process.
const reservation = Bun.serve({
  hostname: '127.0.0.1',
  port: apiPort,
  fetch: () => new Response(null),
});
await reservation.stop(true);
const web = await createServer({
  root: import.meta.dir,
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    allowedHosts: ['127.0.0.1', 'localhost'],
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
});
await web.listen();
const api = Bun.spawn(
  [
    process.execPath,
    '--watch',
    '--no-env-file',
    'server.ts',
    String(apiPort),
    ...(live ? ['--live'] : []),
  ],
  {
    cwd: import.meta.dir,
    detached: process.platform !== 'win32',
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
console.log(`Maelstrom Engine PID: ${api.pid}`);
function signalApi(signal: NodeJS.Signals) {
  try {
    if (process.platform === 'win32') api.kill(signal);
    else process.kill(-api.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  signalApi('SIGTERM');
  await web.close();
  const force = setTimeout(() => signalApi('SIGKILL'), 2000);
  await api.exited;
  clearTimeout(force);
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
void api.exited.then((code) => {
  if (!stopping) void stop(code || 1);
});

let ready = false;
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/config`);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* The watch process is still starting. */
  }
  await Bun.sleep(100);
}
if (!ready) {
  console.error('The Engine did not start. Check its error above.');
  await stop(1);
} else console.log(`Maelstrom development: http://127.0.0.1:${webPort}`);
