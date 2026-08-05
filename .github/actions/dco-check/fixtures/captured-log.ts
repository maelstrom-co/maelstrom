// Workflow annotations ARE the output of the reporting paths, and they only
// exist as lines on stdout, so asserting on them means intercepting them.
export async function capturedLog<T>(
  body: () => Promise<T>,
): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const previous = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    return { result: await body(), lines };
  } finally {
    console.log = previous;
  }
}
