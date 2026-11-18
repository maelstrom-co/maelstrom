import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { basename, join, sep } from 'node:path';

const advisory = 'GHSA-fc5q-39xc-vjpf';
const fingerprints: Record<string, string> = {
  '2.3.2': 'ae714d7447d862e60ead18b4d8dfac96b51944e6cdd043ea6b6da7c1684b13e6',
  '4.0.4': '96e0bbd87266f9d9a2fd578be32e7ad8d90c166755eee64b6d131f31b2e65351',
  '4.0.5': 'e8cdbc560fdf26c91a1b49e934a62420a1c2fb9540b194a27a9d66fd3034defc',
  '4.0.7': '42010893ec225aae77b92c43b967416d39e73df82eb1f65a4659f37670b46729',
};

function runtimeDigest(directory: string): string {
  const hash = createHash('sha256');
  function visit(relative: string): void {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      if (
        !relative &&
        (['LICENSE', 'README.md', 'node_modules'].includes(name) ||
          name.startsWith('.bun-tag-'))
      )
        continue;
      const path = join(relative, name);
      const full = join(directory, path);
      const entry = lstatSync(full);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        hash.update(path.split(sep).join('/') + '\0');
        hash.update(createHash('sha256').update(readFileSync(full)).digest());
      } else throw new Error('Unexpected picomatch file: ' + full);
    }
  }
  visit('');
  return hash.digest('hex');
}

export function verifyPicomatch(root: string): string[] {
  const lock = Bun.JSONC.parse(
    readFileSync(join(root, 'bun.lock'), 'utf8'),
  ) as {
    packages: Record<string, [string, ...unknown[]]>;
  };
  const locked = new Set(
    Object.values(lock.packages)
      .map(([id]) => id)
      .filter((id) => id.startsWith('picomatch@'))
      .map((id) => id.slice('picomatch@'.length)),
  );
  const seenVersions = new Set<string>();
  const seenPackages = new Set<string>();
  const copies: string[] = [];
  function inspectPackage(path: string): void {
    const directory = realpathSync(path);
    if (seenPackages.has(directory)) {
      if (basename(path) === 'picomatch' && !copies.includes(directory))
        throw new Error('Unverified picomatch installation: ' + path);
      return;
    }
    seenPackages.add(directory);
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const { name, version } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (name === 'picomatch' || basename(path) === 'picomatch') {
        if (
          name !== 'picomatch' ||
          !locked.has(version) ||
          runtimeDigest(directory) !== fingerprints[version]
        )
          throw new Error('Unverified picomatch installation: ' + directory);
        seenVersions.add(version);
        copies.push(directory);
      }
    } else if (basename(path) === 'picomatch')
      throw new Error('Missing manifest: ' + path);
    walk(directory);
  }
  const visited = new Set<string>();
  function walk(
    directory: string,
    role: 'tree' | 'modules' | 'scope' = 'tree',
  ): void {
    const key = role + ':' + directory;
    if (visited.has(key)) return;
    visited.add(key);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.jj') continue;
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const child = join(directory, entry.name);
      if (entry.name === 'node_modules') {
        walk(realpathSync(child), 'modules');
      } else if (role === 'modules' && entry.name.startsWith('@')) {
        walk(realpathSync(child), 'scope');
      } else if (role !== 'tree' && !entry.name.startsWith('.')) {
        inspectPackage(child);
      } else if (entry.isDirectory()) {
        walk(child);
      }
    }
  }
  walk(realpathSync(root));
  for (const version of locked)
    if (!seenVersions.has(version))
      throw new Error('No verified installation for picomatch@' + version);
  return copies;
}

if (import.meta.main) {
  const copies = verifyPicomatch(process.cwd()).length;
  if (copies)
    console.log(
      `Verified ${copies} patched picomatch installations for ${advisory}.`,
    );
  const audit = Bun.spawn(
    [process.execPath, 'audit', ...(copies ? ['--ignore', advisory] : [])],
    { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
  );
  process.exitCode = await audit.exited;
}
