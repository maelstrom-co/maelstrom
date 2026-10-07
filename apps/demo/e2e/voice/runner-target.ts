export type RunnerTarget =
  | { mode: 'local'; browserURL: 'http://localhost:3000' }
  | {
      mode: 'remote';
      browserURL: string;
      readinessURL: string;
      metadataURL: string;
    };

export function resolveRunnerTarget(value: string | undefined): RunnerTarget {
  const configured = value?.trim();
  if (!configured)
    return { mode: 'local', browserURL: 'http://localhost:3000' };

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('MAELSTROM_BASE_URL must be a valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname)
    throw new Error('MAELSTROM_BASE_URL must be a valid HTTP(S) URL.');
  if (url.username || url.password)
    throw new Error('MAELSTROM_BASE_URL must not contain credentials.');

  return {
    mode: 'remote',
    browserURL: url.href,
    readinessURL: url.href,
    metadataURL: `${url.origin}${url.pathname}`,
  };
}

export function initialNavigationURL(value: string | undefined): string {
  return resolveRunnerTarget(value).browserURL;
}
