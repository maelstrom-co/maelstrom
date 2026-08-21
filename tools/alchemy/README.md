# Alchemy adoption foundation

This workspace models the three production Cloudflare Workers with Alchemy
`2.0.0-beta.72`. It does not replace Wrangler yet. The existing Wrangler files,
Nx deploy targets, and deployment workflows remain authoritative.

Run the credential-free checks with:

```sh
bunx nx run @maelstrom-co/alchemy:validate
```

There is intentionally no deploy script or CI integration in this package.

Alchemy never builds application code. Complete all credential-free application
builds before any Alchemy plan or deploy:

```sh
bunx nx run @maelstrom-co/www:build
bunx nx run @maelstrom-co/docs:build
bunx nx run @maelstrom-co/demo:build-hosted
```

The hosted demo target sets `VITE_HOSTED=1`. It emits only the SPA client
artifact used by the custom Worker. Do not substitute the normal demo build.

## Cutover

1. From `tools/alchemy`, run
   `bun alchemy cloudflare bootstrap --profile maelstrom-production` and
   inspect `Cloudflare.state()` in the production account. It
   creates the shared `alchemy-state-store` Worker, a SQLite Durable Object,
   and token and encryption-key entries in Cloudflare Secrets Store. Do this as
   a reviewed, out-of-band operation before app adoption.
2. Run the three credential-free Nx builds above. Export the live Wrangler
   configuration and compare an Alchemy `prod` plan resource by resource.
   Supply `RESEND_API_KEY` only after the builds complete. Adopt the existing
   zone, DNSSEC singleton, Workers, custom domains, and `SessionDO`, then verify
   production traffic before changing CI. Wrangler stays the rollback path
   until this succeeds.

The stack accepts only `--stage prod` and fails before declaring resources for
every other stage. It opts the existing production resources into adoption and
retention. Preview support must use a separate stack rather than weakening this
guard.

All three Alchemy resources consume prebuilt artifacts. The `www` Worker uploads
Astro's generated `dist/server` entry without rebundling and serves
`dist/client`. This preserves the dynamic `/api/waitlist` route. The docs Worker
is assets-only over `apps/docs/dist`. Alchemy bundles only the demo's custom
Worker entry and serves the already-built hosted SPA from `dist/client`; it
never deploys TanStack Start's local server routes.

## Credentials

For CI, set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Scope the token
to the production account and the `maelstrom-ai.co` zone. It needs at least:

- Account: Workers Scripts Write and Workers Routes Write.
- Account: Workers Observability Read and Write.
- Account: Secrets Store Read and Write for remote-state bootstrap and CI state access.
- Zone: Zone Read and Edit, DNS Read and Write, and Zone DNS Settings Read and Write.

Use a separately reviewed bootstrap credential if the normal deployment token
must not create the remote state store. Alchemy profile files and remote-state
credentials must remain outside the repository.

## Secrets and DNSSEC

Alchemy requires `RESEND_API_KEY` through `Config.redacted`; the value is never
embedded in source or state output and never enters an application build
process. The first plan must prove that adoption preserves this secret,
`RESEND_SEGMENT_ID`, `ASSETS`, and `IMAGES`. Losing any binding can break
waitlist submissions or image rendering.

The stack adopts and retains the existing zone and DNSSEC configuration.
Cloudflare can expose the DS value, but the Namecheap DS record remains an
out-of-band registrar change. Never rotate or remove it as part of app cutover.

## Previews

Current PR previews create route-free Workers in a separate Cloudflare account.
This foundation does not model them. Migrate previews only after production
adoption, with separate remote state and credentials. Do not point a preview
stage at the production account or attach production domains.
