import { mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface TtsCacheEnvironment {
  readonly override?: string;
  readonly xdgCacheHome?: string;
  readonly home?: string;
  readonly workingDirectory?: string;
}

export async function resolveTtsCacheDir(
  repositoryRoot: string,
  environment: TtsCacheEnvironment = {},
): Promise<string> {
  const {
    override,
    xdgCacheHome,
    home,
    workingDirectory = process.cwd(),
  } = environment;
  const input =
    override ||
    (xdgCacheHome ? join(xdgCacheHome, 'tts2mic-mcp') : '') ||
    (home ? join(home, '.cache/tts2mic-mcp') : '');

  if (!input) {
    throw new Error('Set HOME, XDG_CACHE_HOME, or MAELSTROM_TTS_CACHE_DIR.');
  }

  const root = await realpath(repositoryRoot);
  const candidate = resolve(workingDirectory, input);
  if ([root, candidate].some((path) => /[\r\n]/.test(path))) {
    throw new Error('TTS cache paths must not contain line breaks.');
  }

  await mkdir(candidate, { recursive: true });
  const cache = await realpath(candidate);
  const fromRoot = relative(root, cache);
  if (
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  ) {
    throw new Error('TTS cache directory must be outside the repository.');
  }

  return cache;
}
