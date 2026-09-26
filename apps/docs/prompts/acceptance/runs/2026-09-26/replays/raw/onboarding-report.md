# Manual onboarding trial — repaired fixture

## Result

Executed the onboarding task in `/tmp/maelstrom-coding-agent-trials.96S7SD/onboarding`, after reading canonical prompt `maelstrom-project-onboarding` v1.0.0 and checklist `apps/docs/prompts/acceptance/checklists/onboarding.md`. Implemented a small static support-queue Vessel, kept its heading, explanatory text, and T-104/T-105 presentation, and added an intent form and configured HTTP connector path. The test exercises SDK intent dispatch only against the supplied deterministic simulated connector; there was no live Engine/provider request or credential use.

## Read-only inspection before edits

- Fixture `package.json` and `bun.lock`; React root `src/main.tsx`; app `src/App.tsx`; connector seam `src/testConnector.ts`; Vite config, HTML, and tsconfig. No router, server implementation, authentication owner, persisted state, or pre-existing tests were present. The app initially had only its local two-ticket array and static support queue.
- Installed package manifests and declarations were read from the private fixture's `node_modules`, particularly `@maelstrom-co/react/dist/index.d.ts`, React SDK `README.md` and `dist/lib/{create-maelstrom,vessel,provider,vessel-entry-types,maelstrom-instance-types,maelstrom-state-types}.d.ts`, plus installed Protocol Vessel/request/response declarations and Client connector declarations. Runtime probe `.trial/sdk-runtime.ts` also passed and confirms the three SDK exports resolve.
- Exact package declarations in `package.json`/lock: all four Maelstrom packages are local `file:./vendor/maelstrom-co-<name>-0.1.0-alpha.4.tgz` packages, not registry packages: `@maelstrom-co/react`, `@maelstrom-co/client`, `@maelstrom-co/protocol`, `@maelstrom-co/connectors` each declared at 0.1.0-alpha.4. Resolved `require(<package>/package.json).version` values were each 0.1.0-alpha.4. This agrees with canonical `@maelstrom-co/react` compatibility 0.1.0-alpha.4. `npm ls --depth=0` prints those installed versions but exits 1 because npm marks the packages `invalid` against the local tarball specifier; this is metadata/specifier resolution output, not evidence that they are absent. React/React DOM resolved 19.2.8, TypeScript 5.9.3, Vite 8.2.1, React plugin 5.2.0, Vitest 4.1.9, React Testing Library 16.3.2, jsdom 27.3.0.
- Supplied provenance files record workspace revision `82f711c9ac211a1f4777de301f6da01757cc0bb7`, runtimes, and source checksums; observed runtimes match `runtime-versions.txt`. No install, upgrade, network access, canonical/source repo write, or dependency symlink mutation occurred.

## Candidate inventory and choice

| Candidate | Evidence / plausible user intent | Engine value and exposure decision |
|---|---|---|
| Support queue containing the two displayed tickets | `src/App.tsx`: records T-104 “Cannot update billing address” (Open) and T-105 “Export is missing a column” (Waiting); a support operator may want to ask for and review their queue. | Coherent selectable/presentable unit. Chosen as one developer-authored Vessel with one `queue` Variant and the existing rows. |
| Heading, explanatory sentence, and list markup | `src/App.tsx`: workspace title and “Review the open support queue.” accompany the queue. | Product framing / incidental layout, not separate capabilities; remains outside the Vessel implementation. |
| Per-ticket rows and UI mechanics | Same two source records and list rendering. | No independently meaningful operation is observable. Rows stay content inside the queue; no per-ticket Vessel, actions, or invented states. |

## Implementation and contract

Changed `src/App.tsx` to define/register exactly one `support-queue` Vessel through installed `defineVessel`, `vessel`, and `createMaelstrom` APIs. It has one default `queue` Variant, static ticket props, minSize 3×2, and `actions: []`. A seeded tiling layout presents that developer-authored component on first render, without inventing an Engine response. Existing heading and description are retained, and the rows are rendered with the original ticket content. A form submits the user's text via SDK `useMaelstrom().processIntent`; Maelstrom's Chart renders the selected layouts.

Changed `src/main.tsx` to use the SDK-exported `HttpConnector` only when `VITE_MAELSTROM_API_URL` is configured. Without it, the original queue remains visible with a setup status message. The configured API base URL is passed to the connector; this app contains no server/auth implementation, no provider credentials, and no authorization headers. Backend endpoint and application authentication remain setup/host responsibilities. `src/testConnector.ts` was used unchanged only by the local test; `.trial/sdk-probe.tsx` and `.trial/sdk-runtime.ts` were not modified.

Added `src/App.test.tsx`: one test verifies the unchanged queue is available without connector configuration; another renders the SDK Provider with a wrapper around supplied `createSimulatedConnector()`, checks heading/content/seeded queue, submits intent, and verifies the SDK sends a `user_intent` update with the submitted string to that synthetic connector. The fake ResizeObserver exists only in the jsdom test. The synthetic connector's scripted response is not a live Engine result and does not prove real Engine selection.

## Commands and results

All project commands below explicitly ran after `cd /tmp/maelstrom-coding-agent-trials.96S7SD/onboarding`.

- `node -e "for(const p of ['react','react-dom','@maelstrom-co/react','@maelstrom-co/client','@maelstrom-co/protocol','@maelstrom-co/connectors']) console.log(p,require(p+'/package.json').version)"` — passed; versions listed above.
- `node .trial/sdk-runtime.ts` — passed: “SDK runtime exports resolved; no Vessel or connector was created.”
- `npm run typecheck` — passed (`tsc --noEmit`, includes `src` and `.trial`).
- `npx vitest run src/App.test.tsx` — passed on final run: 1 file, 2 tests.
- `npm run build` — passed; Vite 8.2.1 produced a production bundle. Vite emitted a warning: the main minified chunk is 514.72 kB (>500 kB advisory). No split/refactor was made because outside bounded change.
- `npm run lint` — unavailable, exit 1: no `lint` script.
- `npm run format -- --check` — unavailable, exit 1: no `format` script.
- `npm run` lists only `dev`, `typecheck`, and `build`; no `test` script. Vitest was invoked directly as above.
- `npm ls --depth=0` — exit 1 due npm `invalid` labels for the four `file:` tarball dependencies; actual installed package versions were separately checked from each installed package manifest above.
- `sha256sum src/testConnector.ts .trial/sdk-probe.tsx .trial/sdk-runtime.ts` — final observed hashes respectively `839cbf2ad34a05f71d18eb38730f7ce84dc802066ac972ec53614b6d560b3977`, `cfb0f3f3841dc3ab9d7ea927477dab314773d8874b75213417ec1e4955684b62`, `e2cafad6aed18c63d305234a46acd76205f5b5503454dbff88f4829d19bf6d44`; those files were not edited.
- Secret-pattern scan over `src` excluding tests found no `api_key`, `secret`, or bearer literal. No provider/Engine request was made. No live service test was run or passed.
- `git status --short` — unavailable, exit 128: fixture is not a Git repository. Therefore a Git diff/staged-state assertion is unavailable. Source changes are limited to `src/App.tsx`, `src/main.tsx`, and new `src/App.test.tsx`; the connector and `.trial` probes were not modified. Build output under existing `dist/` was regenerated by required build check.

## Checklist, limitations, and rollback

Checklist: exact declared/resolved SDK packages and versions reported; `src/App.tsx` inventory identifies queue and two tickets; inspection preceded edits; APIs evidenced from installed SDK 0.1.0-alpha.4 declarations/docs; no actions/states/persistence/navigation/live Engine result invented; support rendering preserved with layout/client-owned presentation, Connector kept transport-only, no credentials; typecheck/tests/build passed; lint/format unavailable and live-service check unrun; rollback below.

Setup required: configure `VITE_MAELSTROM_API_URL` to the host's supported Maelstrom HTTP API base URL and ensure that host owns transport/auth. When unset, the UI intentionally remains usable as the original static queue but Maelstrom intent entry is unavailable. No endpoint was supplied, so an integration environment with a configured backend and separately handled auth is still required for live Engine verification. The local synthetic test only verifies intent dispatch and seeded component rendering.

Rollback: revert the three scoped `src/` changes (`App.tsx`, `main.tsx`, `App.test.tsx`) and unset `VITE_MAELSTROM_API_URL`. There is no commit or Git staging to undo. Final source review found no secrets or unrelated source edits.
