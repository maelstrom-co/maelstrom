import net from 'node:net';

interface ForwardPortOptions {
  host?: string;
  targetPort: number;
  listenPort?: number;
  bind?: string;
  onError?: (error: Error) => void;
}

/** TCP forwarding preserves HTTP Host/Origin and WebSocket upgrades unchanged. */
export async function forwardPort({
  host = 'host.docker.internal',
  targetPort,
  listenPort = targetPort,
  bind = '127.0.0.1',
  onError = (error) => console.error(`Forward ${listenPort}: ${error.message}`),
}: ForwardPortOptions) {
  const sockets = new Set<net.Socket>();
  function track(socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  }
  const server = net.createServer((incoming) => {
    track(incoming);
    const outgoing = track(net.connect({ host, port: targetPort }));
    const timer = setTimeout(
      () => outgoing.destroy(new Error('upstream connection timed out')),
      5000,
    );
    timer.unref();
    outgoing.once('connect', () => clearTimeout(timer));
    outgoing.once('close', () => clearTimeout(timer));
    incoming.on('error', () => outgoing.destroy());
    outgoing.on('error', (error) => {
      onError(error);
      incoming.destroy();
    });
    incoming.once('close', () => outgoing.destroy());
    outgoing.once('close', () => incoming.destroy());
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(
      { host: bind, port: listenPort, ipv6Only: bind === '::1' },
      () => {
        server.removeListener('error', reject);
        server.on('error', onError);
        resolve();
      },
    );
  });
  let closing: Promise<void> | undefined;
  return {
    port: (server.address() as net.AddressInfo).port,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
      return closing;
    },
  };
}

export function checkPort(host: string, port: number, timeout = 5000) {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(
      () => socket.destroy(new Error('connection timed out')),
      timeout,
    );
    timer.unref();
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Cannot reach ${host}:${port}. Start Maelstrom on your Mac (bunx nx dev demo). ${error.message}`,
        ),
      );
    });
  });
}
