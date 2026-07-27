# apps/demo/Dockerfile
# Build context is the repo root, not apps/demo -- see wrangler.jsonc's
# containers[0].image_build_context. For a manual `docker build`, run it
# from the repo root: `docker build -f apps/demo/Dockerfile .`
#
# Pinned to a Bun version tag, not a sha256 digest. This repo has no
# Renovate/Dependabot coverage for Docker base images (.github/dependabot.yml
# only watches the github-actions ecosystem), so nothing would ever bump a
# digest pin -- it would freeze this internet-facing container on one Bun
# build forever, trading visible drift for silently missing security patches.
# A version tag still gets rebuilt with patch-level fixes from upstream while
# staying reproducible day-to-day. 1.3.14 is what `oven/bun:1-slim` resolved
# to at the time of this pin; bump the tag by hand when upgrading Bun.
FROM --platform=linux/amd64 oven/bun:1.3.14-slim
WORKDIR /app

# oven/bun images ship a preconfigured, unprivileged `bun` user (uid/gid 1000,
# home /home/bun) for exactly this purpose: dropping root before the app
# runs. WORKDIR above created /app as root, so hand it to `bun` once, here --
# cheap metadata-only change on an otherwise-empty directory. Everything
# COPY'd into it below is chowned at copy time instead of via a later
# recursive chown, which would double the on-disk cost of every file it
# touched (Docker layers are copy-on-write, so `chown -R` after the fact
# re-materializes each file's contents in a new layer on top of the original).
RUN chown bun:bun /app

# Manifest-only COPYs for workspace members whose full source we don't need
# in the image (docs/www apps, build tools): `bun install --frozen-lockfile`
# validates the lockfile against every workspace member matched by the root
# package.json's "workspaces" globs (apps/*, packages/*, tools/*), not just
# the ones apps/demo depends on -- so every member's package.json must be
# present somewhere before install runs, even though ws-server.ts only
# imports @maelstrom-co/client, @maelstrom-co/engine, and
# @maelstrom-co/protocol at runtime. apps/demo and packages/* don't need a
# manifest-only COPY here because the full-source COPYs below already carry
# their package.json.
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun apps/docs/package.json apps/docs/package.json
COPY --chown=bun:bun apps/www/package.json apps/www/package.json
COPY --chown=bun:bun tools/astro-plugin/package.json tools/astro-plugin/package.json
COPY --chown=bun:bun tools/biome-plugin/package.json tools/biome-plugin/package.json

# Real sources for everything the running server needs: apps/demo itself,
# and every packages/* member (the CMD's --conditions @maelstrom-co/source
# resolves every @maelstrom-co/* import straight to packages/*/src).
COPY --chown=bun:bun packages packages
COPY --chown=bun:bun apps/demo apps/demo

# Everything above is chowned to `bun` as it's copied in, so the install
# below can run as `bun` too -- nothing in this image writes as root past
# this point.
USER bun

# Single install, deliberately run only after real sources are staged above.
# Two things used to go wrong when installing before the sources existed:
#
# 1. A dangling-symlink bug: against bare manifests (no packages/*/src yet),
#    bun links some hoisted third-party deps (observed: @tanstack/ai-gemini)
#    into per-workspace node_modules as symlinks into a node_modules/.bun
#    store entry it never populates, and the container then dies at runtime
#    with ENOENT. Installing once the real sources are present avoids the
#    bad link entirely.
# 2. Doubled node_modules: Docker layers are additive, so an install-then-
#    rm-rf-then-reinstall pattern still ships the first install's full
#    node_modules tree in an earlier layer even though a later layer deletes
#    it -- the image only shrinks by collapsing that down to one install.
#
# --production skips devDependencies (nx, vitest, biome, verdaccio, etc.),
# which the running server never imports; the install cache is cleared in
# this same layer since removing it in a later RUN would not reclaim the
# space. No @maelstrom-co registry auth needed: every @maelstrom-co/*
# dependency in this workspace uses workspace:*, so bun resolves it locally
# and never hits npm.pkg.github.com.
#
# Trade-off: no cached install layer, so any source change reinstalls from
# scratch on every build -- acceptable for a deploy image that isn't
# iterated on locally in a build-cache loop.
RUN bun install --frozen-lockfile --production \
  && rm -rf /home/bun/.bun/install/cache

EXPOSE 3001
ENV HOSTED=1

# Bun.serve defaults to binding 0.0.0.0 (ws-server.ts's Bun.serve() call
# has no explicit `hostname`), which is required inside the container.
#
# No build step: packages/*/dist is gitignored and this image never runs a
# build, so `--conditions @maelstrom-co/source` makes bun resolve every
# @maelstrom-co/* import straight to its src/index.ts, the same condition
# apps/demo/vite.config.mjs's ssr resolve already relies on.
CMD ["bun", "run", "--conditions", "@maelstrom-co/source", "apps/demo/src/server/ws-server.ts"]
