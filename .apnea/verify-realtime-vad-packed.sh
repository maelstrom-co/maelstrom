#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp -d)"
tmp_parent="$(dirname "$tmp")"
workspace="$(pwd)"
cleanup() {
  if [[ ! -e "$tmp" ]]; then
    return 0
  fi
  if [[ -d "$tmp" && "$tmp" == "$tmp_parent"/tmp.* ]]; then
    rm -r -- "$tmp"
    return 0
  fi
  printf 'Refusing to remove unexpected temporary path: %s\n' "$tmp" >&2
  return 1
}
trap cleanup EXIT

mkdir -p "$tmp/tarballs" "$tmp/consumer/node_modules/@maelstrom-co" "$tmp/consumer/node_modules/@ricky0123"
(cd packages/realtime-vad && bun pm pack --ignore-scripts --destination "$tmp/tarballs")
tarball="$(find "$tmp/tarballs" -maxdepth 1 -name '*.tgz' -print -quit)"
test -n "$tarball"
tar -tzf "$tarball" | sort
tar -xzf "$tarball" -C "$tmp"
test -f "$tmp/package/dist/index.js"
test -f "$tmp/package/dist/index.d.ts"
test -f "$tmp/package/dist/local-audio-pre-roll.d.ts"
rg -q "createLocalAudioPreRoll" "$tmp/package/dist/index.d.ts"
rg -q "LocalAudioPreRoll" "$tmp/package/dist/index.d.ts"
rg -q '/\*\*' "$tmp/package/dist/local-audio-pre-roll.d.ts"
rg -n '/\*\*|interface LocalAudioPreRoll|createLocalAudioPreRoll|startAutomaticTurn|startManualTurn|clear\(\)|endTurn|destroy' "$tmp/package/dist/local-audio-pre-roll.d.ts"

cat > "$tmp/consumer/package.json" <<'JSON'
{
  "private": true,
  "type": "module"
}
JSON
mv "$tmp/package" "$tmp/consumer/node_modules/@maelstrom-co/realtime-vad"
ln -s "$(realpath packages/realtime-vad/node_modules/@ricky0123/vad-web)" "$tmp/consumer/node_modules/@ricky0123/vad-web"
ln -s "$(realpath packages/realtime-vad/node_modules/onnxruntime-web)" "$tmp/consumer/node_modules/onnxruntime-web"
cat > "$tmp/consumer/consumer.ts" <<'TS'
import {
  createBrowserVad,
  createLocalAudioPreRoll,
  resolveBrowserVadConfig,
  type LocalAudioPreRoll,
} from '@maelstrom-co/realtime-vad';

const factory: (track: MediaStreamTrack) => Promise<LocalAudioPreRoll> =
  createLocalAudioPreRoll;
void factory;
void createBrowserVad;
void resolveBrowserVadConfig;
TS
cat > "$tmp/consumer/runtime.mjs" <<'JS'
const api = await import('@maelstrom-co/realtime-vad');
for (const name of [
  'createBrowserVad',
  'createLocalAudioPreRoll',
  'resolveBrowserVadConfig',
]) {
  if (typeof api[name] !== 'function') throw new Error(`Missing root export: ${name}`);
}
JS
cat > "$tmp/consumer/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "skipLibCheck": false,
    "strict": true,
    "target": "ES2022"
  },
  "files": ["consumer.ts"]
}
JSON
(cd "$tmp/consumer" && "$workspace/node_modules/.bin/tsc" -p tsconfig.json && bun run runtime.mjs)
bun -e 'const p = await Bun.file("packages/realtime-vad/package.json").json(); if (p.publishConfig?.access !== undefined) process.exit(1)'
