#!/usr/bin/env bash
set -euo pipefail

ROOT=${1:?Usage: prepare-trials.sh WORKSPACE_ROOT [TEMP_PARENT]}
ROOT=$(cd "$ROOT" && pwd)
PARENT=${2:-/tmp}
mkdir -p "$PARENT"
TRIAL_ROOT=$(mktemp -d "$PARENT/maelstrom-coding-agent-trials.XXXXXX")
export ROOT TRIAL_ROOT

pack_sdk() {
  local package=$1 package_dir="$TRIAL_ROOT/package-$1" vendor="$TRIAL_ROOT/vendor"
  mkdir -p "$package_dir" "$vendor"
  local raw
  raw=$(npm pack "$ROOT/packages/$package" --pack-destination "$TRIAL_ROOT" --silent)
  tar -xzf "$TRIAL_ROOT/$raw" -C "$package_dir" --strip-components=1
  node - "$package_dir/package.json" "$package" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const packageName = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const catalogVersions = {
  react: { '@tanstack/react-store': '0.9.3' },
  client: { '@tanstack/store': '0.9.3' },
  protocol: { nanoid: '5.1.16', zod: '4.4.3' },
  connectors: {},
};
for (const [dependency, version] of Object.entries(catalogVersions[packageName])) {
  if (manifest.dependencies?.[dependency] !== 'catalog:') {
    throw new Error(`Unexpected catalog dependency: ${packageName}:${dependency}`);
  }
  manifest.dependencies[dependency] = version;
}
fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  local packed
  packed=$(cd "$package_dir" && npm pack --pack-destination "$vendor" --silent)
  printf '%s\n' "$vendor/$packed"
}

# These tarballs contain the built distributions of the checked-out workspace
# packages. They install into each scratch project's private node_modules; they
# never link a project back to the editable workspace package directories.
for package in protocol connectors client react; do pack_sdk "$package" >/dev/null; done
mkdir -p "$TRIAL_ROOT/onboarding" "$TRIAL_ROOT/migration-inventory" "$TRIAL_ROOT/migration-conversion" "$TRIAL_ROOT/modeling/src" "$TRIAL_ROOT/debugging"
cp -R "$ROOT/apps/docs/prompts/acceptance/fixtures/onboarding-react/." "$TRIAL_ROOT/onboarding/"
mkdir -p "$TRIAL_ROOT/migration-inventory/src" "$TRIAL_ROOT/migration-conversion/src" "$TRIAL_ROOT/modeling/src"
cp "$ROOT/apps/docs/prompts/acceptance/fixtures/migration-react/src/SearchPanel.tsx" "$TRIAL_ROOT/migration-inventory/src/SearchPanel.tsx"
cp "$ROOT/apps/docs/prompts/acceptance/fixtures/migration-react/src/search.ts" "$TRIAL_ROOT/migration-inventory/src/search.ts"
cp "$ROOT/apps/docs/prompts/acceptance/fixtures/migration-react/src/SearchPanel.tsx" "$TRIAL_ROOT/migration-conversion/src/SearchPanel.tsx"
cp "$ROOT/apps/docs/prompts/acceptance/fixtures/migration-react/src/search.ts" "$TRIAL_ROOT/migration-conversion/src/search.ts"
cp "$ROOT/apps/docs/prompts/acceptance/fixtures/modeling-react/src/Queue.tsx" "$TRIAL_ROOT/modeling/src/Queue.tsx"
cp "$ROOT/apps/docs/prompts/acceptance/fixtures/debugging-react/report.md" "$TRIAL_ROOT/debugging/report.md"

cat > "$TRIAL_ROOT/vendor-test-connector.ts" <<'MOCK'
import type { AssistantMessage, ConnectorCapabilities, ConnectorEvent, EngineConnector, Unsubscribe } from '@maelstrom-co/client';
import type { ChartRequestMessage, MaelstromResponse, SessionId } from '@maelstrom-co/protocol';

/** Simulated test seam only: this connector never contacts a live Engine. */
export function createSimulatedConnector(): EngineConnector {
  const subscribers: Array<(event: ConnectorEvent) => void> = [];
  return {
    capabilities: { voice: false, streaming: false, stateful: false } satisfies ConnectorCapabilities,
    async connect(_sessionId: SessionId) {},
    async disconnect() {
      for (const handler of subscribers) handler({ type: 'disconnected', clean: true, message: 'simulated test disconnect' });
    },
    async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
      return { type: 'maelstrom_response', requestId: message.id, userMessage: '', rationale: 'Simulated test response; not a live Engine result.', executionPlan: [], layout: { type: 'grid', positions: [] } };
    },
    subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
      subscribers.push(handler);
      return () => { const index = subscribers.indexOf(handler); if (index >= 0) subscribers.splice(index, 1); };
    },
    async addAssistantMessage(_message: AssistantMessage) {},
    async getHistory(_sessionId: SessionId) { return []; },
  };
}
MOCK

cat > "$TRIAL_ROOT/app-scaffold.sh" <<'SCAFFOLD'
#!/usr/bin/env bash
set -euo pipefail
project=$1
mkdir -p "$project/src" "$project/.trial"
cat > "$project/index.html" <<'HTML'
<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Support workspace</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
HTML
cp "$TRIAL_ROOT/vendor-test-connector.ts" "$project/src/testConnector.ts"
cat > "$project/src/App.tsx" <<'TSX'
import { SearchPanel } from './SearchPanel';

export function App() {
  return (
    <main>
      <h1>Support workspace</h1>
      <p>Search support tickets.</p>
      <SearchPanel />
    </main>
  );
}
TSX
cat > "$project/src/main.tsx" <<'TSX'
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
TSX
cat > "$project/vite.config.ts" <<'TS'
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({ plugins: [react()], test: { environment: 'jsdom' } });
TS
cat > "$project/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext",
    "skipLibCheck": true, "moduleResolution": "Bundler",
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true,
    "jsx": "react-jsx", "strict": true, "types": ["vitest/globals"]
  },
  "include": ["src", ".trial"]
}
JSON
cat > "$project/src/SearchPanel.test.tsx" <<'TEST'
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { SearchPanel } from './SearchPanel';

describe('SearchPanel baseline', () => {
  it('keeps empty submission unavailable and renders stub search results', async () => {
    render(<SearchPanel />);
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search tickets'), { target: { value: 'billing' } });
    expect(search).toBeEnabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Search' }).closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent('1 results');
  });
});
TEST
cat > "$project/.trial/sdk-runtime.ts" <<'RUNTIME'
import { strict as assert } from 'node:assert';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
assert.equal(typeof createMaelstrom, 'function');
assert.equal(typeof defineVessel, 'function');
assert.equal(typeof vessel, 'function');
console.log('SDK runtime exports resolved; no Vessel or connector was created.');
RUNTIME
cat > "$project/.trial/sdk-probe.tsx" <<'PROBE'
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import type { ReactNode } from 'react';

export type MaelstromFactoryConfig = Parameters<typeof createMaelstrom>[0];
export type VesselDefinitionFactory = typeof defineVessel;
export type VesselEntryFactory = typeof vessel;
export function SdkImportTypeProbe({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
PROBE
cat > "$project/package.json" <<'JSON'
{
  "name": "prompt-acceptance-support-search",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "build": "vite build", "test": "vitest run" },
  "dependencies": {
    "@maelstrom-co/react": "0.1.0-alpha.4",
    "@maelstrom-co/client": "0.1.0-alpha.4",
    "@maelstrom-co/protocol": "0.1.0-alpha.4",
    "@maelstrom-co/connectors": "0.1.0-alpha.4",
    "@tanstack/react-store": "0.9.3", "@tanstack/store": "0.9.3",
    "react": "19.2.8", "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@types/react": "19.2.18", "@types/react-dom": "19.2.4",
    "@vitejs/plugin-react": "5.2.0", "@testing-library/react": "16.3.2",
    "@testing-library/dom": "10.4.1", "@testing-library/jest-dom": "6.9.1",
    "jsdom": "27.3.0", "typescript": "5.9.3", "vite": "8.2.1",
    "vitest": "4.1.9"
  }
}
JSON
cat > "$project/.trial/noop" <<'TXT'
This directory contains compile-only API/import smoke code, not an implementation or live connector.
TXT
SCAFFOLD
chmod +x "$TRIAL_ROOT/app-scaffold.sh"

# Add the smallest plain app shell around the existing form in both paired
# workspaces. They start as identical trees; no Vessel/Provider conversion is
# seeded. The baseline test is deliberately independent of an Engine.
"$TRIAL_ROOT/app-scaffold.sh" "$TRIAL_ROOT/migration-inventory"
"$TRIAL_ROOT/app-scaffold.sh" "$TRIAL_ROOT/migration-conversion"

# Build an SDK probe for onboarding as a separate compile-only file without
# changing the starter's UI or adding a Connector/Provider implementation.
mkdir -p "$TRIAL_ROOT/onboarding/.trial"
cp "$TRIAL_ROOT/migration-conversion/.trial/sdk-probe.tsx" "$TRIAL_ROOT/onboarding/.trial/sdk-probe.tsx"
cp "$TRIAL_ROOT/migration-conversion/.trial/sdk-runtime.ts" "$TRIAL_ROOT/onboarding/.trial/sdk-runtime.ts"
cp "$TRIAL_ROOT/vendor-test-connector.ts" "$TRIAL_ROOT/onboarding/src/testConnector.ts"
cat > "$TRIAL_ROOT/onboarding/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022", "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext",
    "skipLibCheck": true, "moduleResolution": "Bundler", "resolveJsonModule": true,
    "isolatedModules": true, "noEmit": true, "jsx": "react-jsx", "strict": true
  },
  "include": ["src", ".trial"]
}
JSON

for project in onboarding migration-inventory migration-conversion; do
  mkdir -p "$TRIAL_ROOT/$project/vendor"
  cp "$TRIAL_ROOT/vendor"/*.tgz "$TRIAL_ROOT/$project/vendor/"
  node - "$TRIAL_ROOT/$project/package.json" "$TRIAL_ROOT/$project/vendor" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2];
const vendor = process.argv[3];
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const versions = {
  '@maelstrom-co/react': '0.1.0-alpha.4', '@maelstrom-co/client': '0.1.0-alpha.4',
  '@maelstrom-co/protocol': '0.1.0-alpha.4', '@maelstrom-co/connectors': '0.1.0-alpha.4',
};
for (const [name, version] of Object.entries(versions)) {
  p.dependencies[name] = `file:./vendor/maelstrom-co-${name.slice('@maelstrom-co/'.length)}-${version}.tgz`;
}
const pinned = {
  react: '19.2.8', 'react-dom': '19.2.8',
  '@tanstack/react-store': '0.9.3', '@tanstack/store': '0.9.3',
  '@types/react': '19.2.18', '@types/react-dom': '19.2.4',
  '@vitejs/plugin-react': '5.2.0', typescript: '5.9.3', vite: '8.2.1',
  '@testing-library/react': '16.3.2', '@testing-library/dom': '10.4.1',
  '@testing-library/jest-dom': '6.9.1', jsdom: '27.3.0', vitest: '4.1.9',
};
for (const [name, version] of Object.entries(pinned)) {
  if (Object.hasOwn(p.dependencies, name)) p.dependencies[name] = version;
  else (p.devDependencies ??= {})[name] = version;
}
p.overrides = {
  '@maelstrom-co/react': `file:./vendor/maelstrom-co-react-0.1.0-alpha.4.tgz`,
  '@maelstrom-co/client': `file:./vendor/maelstrom-co-client-0.1.0-alpha.4.tgz`,
  '@maelstrom-co/protocol': `file:./vendor/maelstrom-co-protocol-0.1.0-alpha.4.tgz`,
  '@maelstrom-co/connectors': `file:./vendor/maelstrom-co-connectors-0.1.0-alpha.4.tgz`,
};
for (const name of ['react','client','protocol','connectors']) {
  if (!fs.existsSync(path.join(vendor, `maelstrom-co-${name}-0.1.0-alpha.4.tgz`))) throw new Error(`Missing local SDK tarball ${name}`);
}
fs.writeFileSync(file, `${JSON.stringify(p, null, 2)}\n`);
NODE
  (
    cd "$TRIAL_ROOT/$project"
    bun install
    bun run typecheck
    bun run .trial/sdk-runtime.ts
    bun run build
    if [[ "$project" != onboarding ]]; then bun run test; fi
    node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
for (const name of ['@maelstrom-co/react','@maelstrom-co/client','@maelstrom-co/protocol','@maelstrom-co/connectors']) {
  const manifestPath = require.resolve(`${name}/package.json`);
  const relative = path.relative(process.cwd(), manifestPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${name} resolved outside this scratch project`);
  const version = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version;
  if (version !== '0.1.0-alpha.4') throw new Error(`${name} resolved ${version}, expected local workspace alpha.4`);
  console.log(`${name}=${version} (${manifestPath})`);
}
NODE
  )
done

# Prove that both migration starts are exactly the same SearchPanel source and
# fixture inputs before a trial. Store hashes and isolated paths for handoff.
sha256sum "$TRIAL_ROOT/migration-inventory/src/SearchPanel.tsx" "$TRIAL_ROOT/migration-conversion/src/SearchPanel.tsx" \
  "$TRIAL_ROOT/migration-inventory/src/search.ts" "$TRIAL_ROOT/migration-conversion/src/search.ts" > "$TRIAL_ROOT/migration-baseline.sha256"
cmp "$TRIAL_ROOT/migration-inventory/src/SearchPanel.tsx" "$TRIAL_ROOT/migration-conversion/src/SearchPanel.tsx"
cmp "$TRIAL_ROOT/migration-inventory/src/search.ts" "$TRIAL_ROOT/migration-conversion/src/search.ts"
diff -qr --exclude=node_modules --exclude=vendor --exclude=dist \
  "$TRIAL_ROOT/migration-inventory" "$TRIAL_ROOT/migration-conversion"
(
  cd "$TRIAL_ROOT/onboarding" && node -p '"react="+require("react/package.json").version+" react-dom="+require("react-dom/package.json").version+" SDK="+require("@maelstrom-co/react/package.json").version'
) > "$TRIAL_ROOT/runtime-versions.txt"
printf 'TRIAL_ROOT=%s\n' "$TRIAL_ROOT"
printf 'WORKSPACE_SOURCE_REVISION=%s\n' "$(jj -R "$ROOT" log --no-graph -r @- -T 'commit_id')"
printf 'MODEL_FIXTURE=%s\nDEBUG_REPORT=%s\n' "$TRIAL_ROOT/modeling/src/Queue.tsx" "$TRIAL_ROOT/debugging/report.md"
printf '\n'
for project in onboarding migration-inventory migration-conversion; do
  (cd "$TRIAL_ROOT/$project" && bun pm ls) >> "$TRIAL_ROOT/runtime-versions.txt"
done
for package in react client protocol connectors; do
  sha256sum "$ROOT/packages/$package/package.json" "$ROOT/packages/$package/src/index.ts" "$ROOT/packages/$package/dist/index.js" >> "$TRIAL_ROOT/sdk-source-checksums.sha256"
done
jj -R "$ROOT" log --no-graph -r @- -T 'commit_id' > "$TRIAL_ROOT/workspace-source-revision.txt"
printf '\n' >> "$TRIAL_ROOT/workspace-source-revision.txt"
cat "$TRIAL_ROOT/workspace-source-revision.txt"
cat "$TRIAL_ROOT/migration-baseline.sha256"
cat "$TRIAL_ROOT/runtime-versions.txt"
