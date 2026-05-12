## Cursor Cloud specific instructions

### Overview

Maelstrom is an Nx monorepo using **Bun** as package manager. See `CLAUDE.md` for full architecture, development commands, and coding conventions.

### Quick reference

| Task | Command |
|------|---------|
| Install deps | `bun install` |
| Build all | `npx nx run-many -t build` |
| Test all | `npx nx run-many -t test` |
| Lint all | `npx nx run-many -t lint` |
| Typecheck all | `npx nx run-many -t typecheck` |
| Serve demo (Vite) | `npx nx serve demo` |
| Serve demo WS server | `cd apps/demo && bun run src/server/ws-server.ts` |

### Key caveats

- **Bun must be on PATH**: The update script adds `~/.bun/bin` to PATH. In new shell sessions, run `export PATH="$HOME/.bun/bin:$PATH"` or source `~/.bashrc` before using `bun`.
- **Build before test**: Tests depend on `^build` (packages must be built first). Nx handles this automatically via `targetDefaults`, but if running tests outside Nx, ensure packages are built.
- **Nx sync**: After pulling new changes, if `nx run-many -t build` fails with "workspace is out of sync", run `npx nx sync` first.
- **Demo app has two processes**: The demo requires both the Vite dev server (port 3000) and the WebSocket server (port 3001). `npx nx serve demo` only starts Vite. Start the WS server separately: `cd apps/demo && bun run src/server/ws-server.ts`.
- **GOOGLE_GENERATIVE_AI_API_KEY required for demo E2E**: Without this key, the WS server starts but crashes when clients connect (Gemini provider init fails). Text-only mode still requires the LLM key.
- **GITHUB_TOKEN not required for workspace deps**: All `@maelstrom-co/*` packages resolve from workspace. `bun install` works without `GITHUB_TOKEN` unless a non-workspace published version is referenced.
- **No ESLint**: Linting uses Biome via the custom `@maelstrom-co/biome-plugin` Nx plugin.
