# Maelstrom Library Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the evolved maelstrom libraries from `mar/packages/maelstrom/` back into `maelstrom/packages/`, adapting them to the maelstrom repo's build conventions.

**Architecture:** Full replacement of source code in 4 existing packages (protocol, client, engine, react), creation of 1 new package (voice from client-old), and deletion of 1 package (audio). Each package gets its `src/` replaced with the mar version, while config files (package.json, tsconfig, vite.config) are adapted to maelstrom conventions.

**Tech Stack:** Bun workspaces, Nx, Vite + dts, TypeScript with `@maelstrom/source` custom condition, Vitest

---

### Task 1: Delete the audio package

**Files:**
- Delete: `packages/audio/` (entire directory)

**Step 1: Remove the audio package directory**

```bash
rm -rf packages/audio
```

**Step 2: Verify no other packages depend on audio**

```bash
grep -r "@maelstrom/audio" packages/ apps/ --include="*.json" --include="*.ts" --include="*.tsx"
```

Expected: No results (or only references in the audio package itself, now deleted)

**Step 3: Commit**

```bash
jj new -m "chore: remove @maelstrom/audio package"
```

---

### Task 2: Migrate @maelstrom/protocol

**Files:**
- Delete: `packages/protocol/src/` (existing source)
- Copy: `../mar/packages/maelstrom/protocol/src/` → `packages/protocol/src/`
- Modify: `packages/protocol/package.json`

**Step 1: Replace source directory**

```bash
rm -rf packages/protocol/src
cp -r ../mar/packages/maelstrom/protocol/src packages/protocol/src
```

**Step 2: Update package.json**

Replace `packages/protocol/package.json` with:

```json
{
  "name": "@maelstrom/protocol",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@maelstrom/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "!**/*.tsbuildinfo"
  ],
  "dependencies": {
    "zod": "*"
  }
}
```

**Step 3: Verify tsconfig.lib.json needs no changes**

The existing `tsconfig.lib.json` already has:
- `extends: ../../tsconfig.base.json`
- `module: nodenext`, `moduleResolution: nodenext`
- `references: []` (protocol has no internal deps)

No changes needed.

**Step 4: Verify vite.config.ts needs no changes**

The existing vite.config.ts already matches (single entry, no externals, node environment). No changes needed.

**Step 5: Build and verify**

```bash
nx build @maelstrom/protocol
```

Expected: Build succeeds, `dist/` contains index.js and index.d.ts

**Step 6: Commit**

```bash
jj new -m "feat: migrate @maelstrom/protocol from mar repo"
```

---

### Task 3: Migrate @maelstrom/client

**Files:**
- Delete: `packages/client/src/` (existing source)
- Copy: `../mar/packages/maelstrom/client/src/` → `packages/client/src/`
- Modify: `packages/client/package.json`

**Step 1: Replace source directory**

```bash
rm -rf packages/client/src
cp -r ../mar/packages/maelstrom/client/src packages/client/src
```

**Step 2: Update package.json**

Replace `packages/client/package.json` with:

```json
{
  "name": "@maelstrom/client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@maelstrom/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "dependencies": {
    "@maelstrom/protocol": "workspace:*",
    "@tanstack/store": "*"
  },
  "devDependencies": {
    "@sinonjs/fake-timers": "*"
  }
}
```

**Step 3: Verify tsconfig.lib.json needs no changes**

Already has `references: [{ "path": "../protocol/tsconfig.lib.json" }]`. No changes needed.

**Step 4: Verify vite.config.ts needs no changes**

Already matches pattern. No changes needed.

**Step 5: Build and verify**

```bash
nx build @maelstrom/client
```

Expected: Build succeeds

**Step 6: Run tests**

```bash
nx test @maelstrom/client
```

Note: Some tests may fail due to missing dev dependencies. If so, add them.

**Step 7: Commit**

```bash
jj new -m "feat: migrate @maelstrom/client from mar repo"
```

---

### Task 4: Migrate @maelstrom/engine

**Files:**
- Delete: `packages/engine/src/` (existing source)
- Copy: `../mar/packages/maelstrom/engine/src/` → `packages/engine/src/`
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/vite.config.ts` (remove env var defines, no longer needed for @tanstack/ai)

**Step 1: Replace source directory**

```bash
rm -rf packages/engine/src
cp -r ../mar/packages/maelstrom/engine/src packages/engine/src
```

**Step 2: Update package.json**

Replace `packages/engine/package.json` with:

```json
{
  "name": "@maelstrom/engine",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@maelstrom/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "!**/*.tsbuildinfo"
  ],
  "dependencies": {
    "@tanstack/ai": "*",
    "@tanstack/ai-gemini": "*",
    "effect": "*"
  },
  "devDependencies": {
    "@maelstrom/protocol": "workspace:*"
  },
  "nx": {
    "name": "@maelstrom/engine"
  }
}
```

**Step 3: Simplify vite.config.ts**

Remove the `loadEnv` and `define` block (those were for Vercel AI SDK env vars). Replace the engine vite.config.ts with:

```typescript
/// <reference types='vitest' />

import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/maelstrom/engine',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: '@maelstrom/engine',
      fileName: 'index',
      formats: ['es' as const],
    },
    rollupOptions: {
      external: [],
    },
  },
  test: {
    name: '@maelstrom/engine',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
```

**Step 4: Add Effect language service plugin to tsconfig.lib.json**

Add the Effect plugin to tsconfig.lib.json's compilerOptions.plugins:

```json
"plugins": [{ "name": "@effect/language-service" }]
```

**Step 5: Build and verify**

```bash
nx build @maelstrom/engine
```

**Step 6: Commit**

```bash
jj new -m "feat: migrate @maelstrom/engine from mar repo"
```

---

### Task 5: Create @maelstrom/voice package (from client-old)

**Files:**
- Create: `packages/voice/` (new directory)
- Copy: `../mar/packages/maelstrom/client-old/src/` → `packages/voice/src/`
- Create: `packages/voice/package.json`
- Create: `packages/voice/tsconfig.json`
- Create: `packages/voice/tsconfig.lib.json`
- Create: `packages/voice/vite.config.ts`

**Step 1: Create package directory and copy source**

```bash
mkdir -p packages/voice
cp -r ../mar/packages/maelstrom/client-old/src packages/voice/src
```

**Step 2: Create package.json**

Write `packages/voice/package.json`:

```json
{
  "name": "@maelstrom/voice",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@maelstrom/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "dependencies": {
    "@maelstrom/client": "workspace:*",
    "@maelstrom/protocol": "workspace:*",
    "onnxruntime-web": "*"
  }
}
```

**Step 3: Create tsconfig.json**

Write `packages/voice/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    },
    {
      "path": "./tsconfig.spec.json"
    }
  ]
}
```

**Step 4: Create tsconfig.lib.json**

Write `packages/voice/tsconfig.lib.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo",
    "emitDeclarationOnly": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "forceConsistentCasingInFileNames": true,
    "lib": ["es2022", "dom"],
    "types": ["node", "vite/client"]
  },
  "include": ["src/**/*.ts"],
  "references": [
    {
      "path": "../protocol/tsconfig.lib.json"
    },
    {
      "path": "../client/tsconfig.lib.json"
    }
  ],
  "exclude": [
    "vite.config.ts",
    "vite.config.mts",
    "vitest.config.ts",
    "vitest.config.mts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.test.tsx",
    "src/**/*.spec.tsx",
    "src/**/*.test.js",
    "src/**/*.spec.js",
    "src/**/*.test.jsx",
    "src/**/*.spec.jsx"
  ]
}
```

**Step 5: Create vite.config.ts**

Write `packages/voice/vite.config.ts`:

```typescript
/// <reference types='vitest' />

import * as path from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/maelstrom/voice',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: '@maelstrom/voice',
      fileName: 'index',
      formats: ['es' as const],
    },
    rollupOptions: {
      external: [],
    },
  },
  test: {
    name: '@maelstrom/voice',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
```

**Step 6: Build and verify**

```bash
nx build @maelstrom/voice
```

**Step 7: Commit**

```bash
jj new -m "feat: create @maelstrom/voice package from client-old"
```

---

### Task 6: Migrate @maelstrom/react

**Files:**
- Delete: `packages/react/src/` (existing source)
- Copy: `../mar/packages/maelstrom/react/src/` → `packages/react/src/`
- Modify: `packages/react/package.json`
- Modify: `packages/react/tsconfig.lib.json` (add voice reference)
- Modify: `packages/react/src/lib/vad/use-vad.ts` (update import)
- Modify: `packages/react/src/lib/use-maelstrom-voice.ts` (update import)

**Step 1: Replace source directory**

```bash
rm -rf packages/react/src
cp -r ../mar/packages/maelstrom/react/src packages/react/src
```

**Step 2: Update import paths from @maelstrom/client-old to @maelstrom/voice**

In `packages/react/src/lib/vad/use-vad.ts`, replace:
```typescript
} from '@maelstrom/client-old';
```
with:
```typescript
} from '@maelstrom/voice';
```

In `packages/react/src/lib/use-maelstrom-voice.ts`, replace:
```typescript
} from '@maelstrom/client-old';
import { VoiceSession } from '@maelstrom/client-old';
```
with:
```typescript
} from '@maelstrom/voice';
import { VoiceSession } from '@maelstrom/voice';
```

**Step 3: Update package.json**

Replace `packages/react/package.json` with:

```json
{
  "name": "@maelstrom/react",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    "./package.json": "./package.json",
    ".": {
      "@maelstrom/source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "dependencies": {
    "@maelstrom/client": "workspace:*",
    "@maelstrom/protocol": "workspace:*",
    "@maelstrom/voice": "workspace:*",
    "@tanstack/store": "*",
    "@tanstack/react-store": "*",
    "onnxruntime-web": "*"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "*",
    "@testing-library/react": "*",
    "jsdom": "*"
  },
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-dom": ">=18.0.0"
  }
}
```

**Step 4: Add voice reference to tsconfig.lib.json**

Add to the `references` array in `packages/react/tsconfig.lib.json`:

```json
{
  "path": "../voice/tsconfig.lib.json"
}
```

So the full references become:
```json
"references": [
  { "path": "../client/tsconfig.lib.json" },
  { "path": "../protocol/tsconfig.lib.json" },
  { "path": "../voice/tsconfig.lib.json" }
]
```

**Step 5: Verify vite.config.ts needs no changes**

Already has react plugin, jsdom environment, and correct externals. No changes needed.

**Step 6: Build and verify**

```bash
nx build @maelstrom/react
```

**Step 7: Commit**

```bash
jj new -m "feat: migrate @maelstrom/react from mar repo"
```

---

### Task 7: Update root package.json dependencies

**Files:**
- Modify: `package.json` (root)

**Step 1: Add new dependencies to root package.json**

Add to `dependencies`:
```json
{
  "@tanstack/ai": "*",
  "@tanstack/ai-gemini": "*",
  "@tanstack/store": "*",
  "@tanstack/react-store": "*",
  "effect": "*",
  "onnxruntime-web": "*",
  "zod": "*"
}
```

Remove from `dependencies` (no longer needed):
```json
{
  "ai": "^5.0.0",
  "@ai-sdk/anthropic": "^2.0.0",
  "@ai-sdk/google": "^2.0.0",
  "@ai-sdk/openai": "^2.0.0"
}
```

Add to `devDependencies`:
```json
{
  "@sinonjs/fake-timers": "*",
  "@effect/language-service": "*"
}
```

**Step 2: Install dependencies**

```bash
bun install
```

**Step 3: Commit**

```bash
jj new -m "chore: update root dependencies for migrated packages"
```

---

### Task 8: Full build and test verification

**Step 1: Build all packages in dependency order**

```bash
nx run-many -t build
```

Expected: All packages build successfully

**Step 2: Run type checking**

```bash
nx run-many -t typecheck
```

Expected: No type errors

**Step 3: Run all tests**

```bash
nx run-many -t test
```

Note: Some tests may fail if they depend on mar-specific test infrastructure (test fixtures, mocks). Fix any failures.

**Step 4: If tests fail, triage and fix**

For each failing test:
- If it fails due to missing test deps → add to devDependencies
- If it fails due to mar-specific infrastructure → adapt or skip for now
- If it fails due to import path issues → fix the import

**Step 5: Commit any test fixes**

```bash
jj new -m "fix: resolve test failures after library migration"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the architecture diagram**

Replace the architecture section with:

```markdown
## Architecture

```
@maelstrom/protocol  (foundation: shared types, schemas, message contract)
         │
    ┌────┴────┐
    ▼         ▼
@maelstrom/client   @maelstrom/engine
(framework-agnostic) (LLM decision core)
    │
    ├────────────┐
    ▼            ▼
@maelstrom/react  @maelstrom/voice
(React bindings)  (audio capture/playback, VAD)
```
```

**Step 2: Update the package table**

Add voice package:

```markdown
| `@maelstrom/voice` | `packages/voice/` | Client-side audio: capture, playback, VAD, voice sessions |
```

Remove audio package row.

**Step 3: Commit**

```bash
jj new -m "docs: update CLAUDE.md with new package structure"
```

---

### Task 10: Clean up mar references

**Step 1: Verify the mar repo's maelstrom packages can be removed**

```bash
grep -r "from '@maelstrom/" ../mar/packages/mar/ ../mar/apps/ --include="*.ts" --include="*.tsx" | head -20
```

This checks if mar's own code imports from the maelstrom packages. If it does, those imports will need to be updated to point to the external `@maelstrom/*` packages (via workspace reference to the maelstrom repo). This is a follow-up task for the mar repo, not part of this migration.

**Step 2: Final verification in maelstrom repo**

```bash
nx run-many -t build
nx run-many -t typecheck
nx run-many -t test
```

Expected: All green.
