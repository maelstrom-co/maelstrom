# apps/demo/Dockerfile
# Build context is the repo root, not apps/demo -- see wrangler.jsonc's
# containers[0].image_build_context. For a manual `docker build`, run it
# from the repo root: `docker build -f apps/demo/Dockerfile .`
FROM --platform=linux/amd64 oven/bun:1-slim
WORKDIR /app

# Copy manifests first for layer caching. `bun install --frozen-lockfile`
# checks the lockfile against every workspace member matched by the root
# package.json's "workspaces" globs (apps/*, packages/*, tools/*), not just
# the ones apps/demo depends on -- so every member's package.json must be
# present here even though ws-server.ts only imports @maelstrom-co/engine
# and @maelstrom-co/protocol at runtime.
COPY package.json bun.lock ./
COPY apps/demo/package.json apps/demo/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY apps/www/package.json apps/www/package.json
COPY tools/astro-plugin/package.json tools/astro-plugin/package.json
COPY tools/biome-plugin/package.json tools/biome-plugin/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/react/package.json packages/react/package.json
COPY packages/react-realtime/package.json packages/react-realtime/package.json
COPY packages/realtime/package.json packages/realtime/package.json
COPY packages/realtime-server/package.json packages/realtime-server/package.json

# No @maelstrom-co registry auth needed: every @maelstrom-co/* dependency in
# this workspace uses workspace:*, so bun resolves it locally and never
# hits npm.pkg.github.com.
RUN bun install --frozen-lockfile

COPY packages packages
COPY apps/demo apps/demo

EXPOSE 3001
ENV HOSTED=1

# Bun.serve defaults to binding 0.0.0.0 (ws-server.ts's Bun.serve() call
# has no explicit `hostname`), which is required inside the container.
CMD ["bun", "run", "apps/demo/src/server/ws-server.ts"]
