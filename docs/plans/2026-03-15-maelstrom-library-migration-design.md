# Maelstrom Library Migration Design

**Date:** 2026-03-15
**Goal:** Move maelstrom libraries from `mar/packages/maelstrom/` back into `maelstrom/packages/`, replacing the current (earlier) versions.

## Context

The maelstrom libraries were originally developed in the maelstrom repo, then moved into the mar repo to build a realistic application. During that time they evolved significantly. Now we're moving them back.

## Package Mapping

| Source (mar) | Destination (maelstrom) | Action |
|---|---|---|
| `packages/maelstrom/protocol/` | `packages/protocol/` | Replace src, adapt config |
| `packages/maelstrom/client/` | `packages/client/` | Replace src, adapt config |
| `packages/maelstrom/engine/` | `packages/engine/` | Replace src, adapt config |
| `packages/maelstrom/react/` | `packages/react/` | Replace src, adapt config |
| `packages/maelstrom/client-old/` | `packages/voice/` | New package as `@maelstrom/voice` |
| `packages/maelstrom/client-v2/` | — | Skip (incomplete) |
| — | `packages/audio/` | Delete |

## Dependency Graph

```
@maelstrom/protocol  (foundation, no internal deps)
    ↑
    ├─── @maelstrom/client (message processing, connections, orchestrator)
    │       ↑
    │       └─── @maelstrom/react (React hooks + components)
    │               ↑
    │               └─── @maelstrom/voice (audio capture/playback, VAD)
    │
    ├─── @maelstrom/engine (AI + voice providers, independent)
    │
    └─── @maelstrom/voice (client-side audio, depends on client + protocol)
```

## Per-Package Config Approach

For each package:
1. Replace `src/` with mar version's source code
2. Rewrite `package.json` to match maelstrom conventions:
   - `@maelstrom/source` custom condition in exports
   - `dist/` output paths
   - `workspace:*` for internal deps
   - `*` for external deps
3. Rewrite `tsconfig.lib.json` extending `../../tsconfig.base.json` with `module: nodenext`
4. Rewrite `vite.config.ts` following existing pattern (dts plugin, ES modules)

## Dependency Changes

### protocol
- Add: `zod` (mar version uses zod schemas)

### client
- Add: `@tanstack/store`
- Keep: `@maelstrom/protocol` (workspace:*)

### engine
- Remove: `ai` (Vercel AI SDK), `@ai-sdk/*` providers
- Add: `@tanstack/ai`, `@tanstack/ai-gemini`, `effect`
- Keep: `@maelstrom/protocol` (workspace:*, in devDeps)

### react
- Add: `@maelstrom/voice` (workspace:*), `@tanstack/store`, `@tanstack/react-store`, `onnxruntime-web`
- Keep: `@maelstrom/client`, `@maelstrom/protocol` (workspace:*)

### voice (new)
- Dependencies: `@maelstrom/client` (workspace:*), `@maelstrom/protocol` (workspace:*), `onnxruntime-web`

## Import Path Updates

- In `react/` source: replace `@maelstrom/client-old` → `@maelstrom/voice`
- All other `@maelstrom/*` imports remain unchanged

## Root Config Updates

- Root `package.json`: Add new external deps (zod, @tanstack/store, @tanstack/react-store, @tanstack/ai, @tanstack/ai-gemini, effect, onnxruntime-web)
- `CLAUDE.md`: Update architecture diagram and package table to include `@maelstrom/voice`
- `vitest.workspace.ts`, `nx.json`: No changes needed (auto-discovery)
