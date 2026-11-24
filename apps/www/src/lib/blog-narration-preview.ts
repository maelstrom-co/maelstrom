const namespace = /^\/pr-[1-9]\d*\/[a-f0-9]{40}\/$/u;
const originPattern = /^https:\/\/[a-z0-9.-]+$/u;

export function previewNarrationBase(origin: string, pr: string, sha: string) {
  const path = `/pr-${pr}/${sha}/`;
  const base = parsePreviewNarrationBase(`${origin}${path}`);
  if (!base)
    throw new Error('Invalid preview narration delivery origin or revision');
  return base;
}

export function parsePreviewNarrationBase(value: unknown): URL | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (
      originPattern.test(url.origin) &&
      url.hostname.includes('.') &&
      namespace.test(url.pathname) &&
      url.href === value &&
      value === url.origin + url.pathname
    )
      return url;
  } catch {
    return undefined;
  }
  return undefined;
}
