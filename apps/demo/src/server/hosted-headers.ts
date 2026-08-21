import { normalize, resolve } from 'node:path';

export interface HeaderRule {
  readonly pattern: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
}

/**
 * Parses Cloudflare Pages `_headers` syntax: a path pattern, then indented
 * `Name: value` lines. The hosted e2e stand-in applies the same file the
 * Worker assets would, so local launch-readiness cannot drift from prod CSP.
 */
export function parseHeaderRules(source: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let pattern: string | undefined;
  let headers: Array<readonly [string, string]> = [];

  const flush = () => {
    if (pattern === undefined) return;
    rules.push({ pattern, headers });
    pattern = undefined;
    headers = [];
  };

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      flush();
      pattern = line.trim();
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1 || pattern === undefined) {
      throw new Error(`Invalid _headers line: ${line}`);
    }
    headers.push([
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    ]);
  }
  flush();
  return rules;
}

export function pathMatches(pathname: string, pattern: string): boolean {
  if (pattern === '/*' || pattern === '*') return true;
  if (pattern.endsWith('*')) {
    return pathname.startsWith(pattern.slice(0, -1));
  }
  return pathname === pattern;
}

export function headersForPath(
  pathname: string,
  rules: readonly HeaderRule[],
): Headers {
  const headers = new Headers();
  for (const rule of rules) {
    if (!pathMatches(pathname, rule.pattern)) continue;
    for (const [name, value] of rule.headers) {
      headers.set(name, value);
    }
  }
  return headers;
}

export function resolveClientFile(
  pathname: string,
  root: string,
): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (relative.split('/').includes('..')) return undefined;
  const resolved = resolve(root, relative);
  const normalizedRoot = normalize(`${root}/`);
  if (resolved !== root && !resolved.startsWith(normalizedRoot)) {
    return undefined;
  }
  return resolved;
}
