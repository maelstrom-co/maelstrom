# React inventory — manual acceptance trial

## Trial scope and outcome

- Canonical prompt: `maelstrom-react-inventory`, version `1.0.0` (read from the supplied canonical prompt). Product goal substituted: “Plan how to make the support queue in src/App.tsx available as a developer-authored Maelstrom Vessel without changing current behavior.” Repository root: `/tmp/maelstrom-prompt-acceptance.0ncOs4/inventory-react`.
- This was a read-only planning trial. No edits, generators, package installs, build, typecheck, or application launch were performed. No files in the fixture changed.
- The pilot is clearly the support queue. Exact Maelstrom integration APIs cannot be planned safely: there is no declared or fixture-resolvable `@maelstrom-co/*` SDK package or source, and no lockfile. Do not invent Vessel/Engine APIs or proceed to implementation until the compatible SDK evidence is available.

## Observed application architecture and dependency evidence

- `package.json`: private ESM app with `dev`, `typecheck`, and `build` scripts. No test script or test dependency declared. Dependency ranges are `react: ^19.0.0`, `react-dom: ^19.0.0`, `vite: ^8.0.13`, `@vitejs/plugin-react: ^5.2.0`; dev ranges include TypeScript `~5.9.2` and React type packages `^19.0.0`. No `@maelstrom-co/*` dependency is declared. No lockfile is present in the fixture, so there are no reproducible resolved dependency versions recorded by this project.
- Fixture `node_modules` is a symlink to the read-only source repository's node_modules. Actual root-resolvable packages reported by `npm ls --depth=0`: Vite `8.2.1`, plugin-react `5.2.0`, TypeScript `5.9.3`, `@types/react` `19.2.18`, and `@types/react-dom` `19.2.4`. npm reports React and React DOM as unmet dependencies (`^19.0.0`); they are not resolvable from the fixture's root dependency paths. A matching shared package-store directory is not evidence of fixture installation. No `@maelstrom-co/react` or other `@maelstrom-co/*` package was resolvable, and the fixture has no SDK source. SDK expected compatibility in the prompt metadata is `@maelstrom-co/react` `0.1.0-alpha.4`, but that is a compatibility declaration, not an installed/resolved version.
- `src/main.tsx` mounts `App` under React `StrictMode` into `#root`, throwing if the element is missing. `index.html` defines that root and loads `/src/main.tsx` (title “Support workspace”). `vite.config.ts` only configures the React plugin. `tsconfig.json` enables strict type checking, JSX transform, and includes `src`.
- `src/App.tsx` is the only application UI/data source: module-level `tickets` array has two static entries; `App` renders a heading, explanatory paragraph and unordered queue. No router, state/data layer, network/server boundary, persistence, handlers, or Maelstrom integration is evidenced. Only `src/App.tsx` and `src/main.tsx` exist under `src`; no tests or other UI/state sources are present. These are observations of this fixture, not claims about external services.

## Capability inventory

| Capability and observed behavior | Source evidence | Plausible user intent | Engine value as a unit | Decision |
| --- | --- | --- | --- | --- |
| Support queue: display a heading, short prompt, and the two ticket subjects with status text. Static data lists `T-104` (“Cannot update billing address”, `Open`) and `T-105` (“Export is missing a column”, `Waiting`). | `src/App.tsx:1-17`; module-level `tickets` at lines 1-4, mapping/rendering at lines 5-17. | Inspect the current support workload/queue. | Yes: this is the complete user-facing capability and a useful independently selected/placed unit; the goal explicitly asks to expose it. | **Expose as the smallest developer-authored pilot**, subject to resolving SDK API/version evidence. One display-only Variant is enough; no Actions. |
| Ticket status/subject typography, list markup, page heading, and explanatory text. | Same rendered markup in `src/App.tsx:6-17`. | Understand the displayed queue and ticket labels. | No independent value evidenced; these are queue content/presentation, not separate capabilities. | Keep internal to the queue Vessel; do not expose separately. |

## Pilot behavior and ownership

| State or operation | Evidence | Props/data owner | Side effects and owner |
| --- | --- | --- | --- |
| Display current queue of static ticket records. | `tickets` is a module-level constant in `src/App.tsx:1-4`; `App` maps it in lines 10-16. | Currently the application module owns the fixed data; no props or external owner is evidenced. | None evidenced. No mutations or external effects are present. |
| Ticket statuses shown: `Open` and `Waiting`. | Literal status values in `src/App.tsx:2-3`, rendered in line 14. | Same application-owned static array. | None evidenced. These labels do not establish legal transitions or selectable status states. |
| Mount the application. | `src/main.tsx:1-12`. | Application entry owns mounting `App`. | React DOM mount; no queue-specific side effect. |

There is no evidence for loading/error/empty variants, ticket selection, actions, transitions, persistence, routing, API calls, or mutable state. Do not define any of these. The intended Vessel's precise registration, Variant schema, props/data binding, and placement APIs are unknown because the compatible SDK is absent; seek SDK package/source/version and app-specific integration constraints before implementing.

## Bounded implementation and test plan (proposed only)

1. Obtain the actual compatible `@maelstrom-co/react` `0.1.0-alpha.4` package/source and supported integration documentation, plus a reproducible dependency resolution for the app. Confirm API types and the developer-authored Vessel registration/selection path before choosing a code seam. This is a blocking evidence prerequisite, not permission to install or change anything during this trial.
2. Once APIs are verified and approved, make the smallest app-owned change around `src/App.tsx` (and only SDK-required entry/config seam if evidence demands it): expose the existing support queue as a developer-authored capability, preserving the same rendered heading, paragraph, ticket order, subjects, and statuses. Preserve module/application data ownership. Use one display Variant and no Actions unless new evidence establishes an existing legal operation. Do not move data or decisions to a model/client Engine, add states, or change routing/rendering.
3. Add focused tests for the supported Vessel representation/render output, verifying both tickets and displayed labels and unchanged existing presentation. Run the fixture's typecheck/build only after dependencies are correctly available. If a local Engine stub/test path exists, clearly scope its result; separately verify with the live Engine only if credentials/service access is explicitly provided. No live verification occurred in this trial.

## Rollback and open unknowns

- Rollback: revert only the eventual Vessel registration/adapter and the narrowly scoped entry or `App.tsx` integration, restoring the current `main.tsx` mount and original `App` render. No rollback was needed in this read-only trial.
- Blocker: SDK package/source and exact API are unavailable from the fixture; no safe API-level implementation plan or compatibility judgment can be made. There is no lockfile, and React/React DOM are unmet from the shared `node_modules` symlink, so fixture typecheck/build validity cannot be established. No router, state/data layer, tests, or existing integration are evidenced. Live Engine availability/behavior is unknown and not verified.
- Required checks left unrun: typecheck, build, any tests, and live Engine verification. These are explicitly not passes; the task was strict read-only and SDK/React resolution is incomplete.

## Read-only commands and unchanged-fixture evidence

Commands actually run (all from the fixture unless paths are explicit):

- `pwd && ls -la && find . -maxdepth 4 -type f -not -path './node_modules/*' -print | sort && ... sha256sum` — inspected fixture inventory and recorded initial SHA-256 checksums.
- `find src -maxdepth 5 -print | sort` — confirmed source inventory.
- A read-only `node --input-type=module` package-resolution probe for React, React DOM, Vite, plugin-react, TypeScript, and Maelstrom package names — reported Vite `8.2.1`, TypeScript `5.9.3`, and inability to resolve React/React DOM and Maelstrom packages (plugin package.json subpath is not exported).
- `find node_modules/.bun ...` — inspected shared package-store directory names; not treated as proof of fixture resolution.
- `npm ls --depth=0` — returned exit 1; showed Vite `8.2.1`, plugin-react `5.2.0`, TypeScript `5.9.3`, React type versions, and unmet React/React DOM ranges, with unrelated packages extraneous due the shared symlink.
- `find . -maxdepth 2 ...lockfile...` — found no fixture lockfile.
- `git status --short -- .` — failed because fixture is not a Git repository; it does not establish a clean Git status.
- `find ... sha256sum` again at the end — each fixture file excluding the shared `node_modules` symlink exactly matched its initial checksum: `index.html` `48802318cbd261a29f95d628b7fde87b89cb73a4ca06f0099ed074c233bddd3d`; `package.json` `3e909fbbb0779de492d8acfa3b69696e78d17eba4a4baddee32d8b3975adf361`; `src/App.tsx` `62a44217c1cc1fd5829771a88d6f7f813653441fe4d542d482d9bee17840f5c7`; `src/main.tsx` `3d20db4608a72bab402162898b2284cfbd567616c37134097db0e48d5a83d575`; `tsconfig.json` `073d540e5cbb79b62d8709aa1ba04fd8f8a2a69e78965c8602ce4e18c1e4ef24`; `vite.config.ts` `072ef0422d3e4033ae783e213ca275349c652e81cc13ee65a67162de40c3cfd9`. The `node_modules` symlink remained pointed at `/Users/javcab/Documents/maelstrom/maelstrom-prompting/node_modules`; it was read-only and excluded from fixture file checksums.

No fixture files were changed. This report is the requested trial artifact.
