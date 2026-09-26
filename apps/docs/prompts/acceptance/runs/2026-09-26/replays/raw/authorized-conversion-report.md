# Manual acceptance trial: SearchPanel Vessel conversion

## Outcome and scope

Implemented the approved bounded conversion in the new fixture `/tmp/maelstrom-coding-agent-trials.96S7SD/migration-conversion` only. I did not use or modify the prior scratch fixture, paired inventory fixture, source repository, canonical prompts/checklists, supplied connector or `.trial` probes. No dependencies were installed or upgraded, no request was sent, and there are no commits.

Canonical prompt: `maelstrom-react-conversion` v1.0.0. Updated migration checklist was read. The goal was to make the existing search capability available as one developer-authored selectable Vessel while preserving its UI and app-owned search boundary.

## Provenance and dependency versions

- Source revision file: `workspace-source-revision.txt` records `82f711c9ac211a1f4777de301f6da01757cc0bb7`.
- Verified every entry in `sdk-source-checksums.sha256` with `sha256sum -c`: all 12 listed SDK source/package/dist files matched.
- Runtime provenance file: `runtime-versions.txt` records React and React DOM `19.2.8`, SDK `0.1.0-alpha.4`.
- Fixture `package.json` and `bun.lock` declare the four SDK packages as local vendor tarballs. Direct inspection of installed package metadata showed `@maelstrom-co/react`, `@maelstrom-co/client`, `@maelstrom-co/protocol`, and `@maelstrom-co/connectors` all resolved to `0.1.0-alpha.4`; React and React DOM are `19.2.8`.
- `npm ls --depth=0` returned an `ELSPROBLEMS` failure, marking the four local tarball dependencies invalid relative to npm's tree check despite installed package metadata, TypeScript, tests, build, and runtime import succeeding. No package-manager repair or install was attempted.

For APIs used, I inspected the installed React package README and declaration files for `createMaelstrom`, `vessel`, provider props, and typed vessel component props; installed protocol declarations for `defineVessel` and Vessel shapes; and read the checksummed read-only SDK source for `createMaelstrom`, `vessel`, protocol Vessel definitions and SDK tests. Evidence confirms `defineVessel` preserves literal types, `vessel(definition, component)` registers the eagerly loaded component, and `createMaelstrom({ vessels })` exposes entries to its Provider/hooks. SDK runtime export probe ran successfully before implementation and reported the imports resolved without creating a connector or sending a request.

## Baseline behavior and changes

Baseline `src/SearchPanel.tsx` had a controlled query input; empty/whitespace query disabled submission; form submit prevented default, set pending and cleared the prior error, invoked `searchTickets(query)`, rendered a fixed error alert on rejection, rendered a success result count, and reset pending in `finally`. `src/search.ts` rejects an empty trimmed query and otherwise returns its documented deterministic stub result. Baseline `App` rendered the SearchPanel directly. The captured `migration-baseline.sha256` hashes for SearchPanel and search matched before editing. The fixture is not a git repository.

Changed files:

- `src/SearchPanel.tsx`: added one typed, developer-authored Vessel definition, with a single `search` variant, empty props and no Actions. Existing controlled form, state transitions, rendering, and `searchTickets` call remain unchanged inside SearchPanel.
- `src/App.tsx`: registered that definition and existing component with installed SDK `vessel()` and exposed a `createMaelstrom({ vessels })` instance. Existing page layout and direct SearchPanel rendering remain intact.
- `src/SearchPanel.test.tsx`: replaced the baseline smoke test with four focused tests. The UI tests render the component from the registered entry with the selected `search` variant. They verify sole registration/no Actions, disabled empty submit and delegation with the submitted query, pending/disabled rendering followed by success, and error feedback/re-enabled button on rejection. Search is mocked at the application-owned boundary; no external request is made.
- `.trial/authorized-conversion-evidence.txt`: added raw command/output evidence for provenance, final checks, limitations, and the initial test cleanup failure. Supplied `.trial` probes remain unchanged.

`src/search.ts`, `src/main.tsx`, `src/testConnector.ts`, `.trial/noop`, `.trial/sdk-probe.tsx`, `.trial/sdk-runtime.ts`, manifests and lockfile remain byte-identical to their captured baseline hashes. No credentials or request logic were added.

## Checks and results

Commands were run with explicit `cd /tmp/maelstrom-coding-agent-trials.96S7SD/migration-conversion`.

- Baseline `npm run typecheck`, `npm test`, `npm run build`: passed before edits (baseline test file: 1 test).
- First post-edit combined typecheck/test/build/runtime command: typecheck passed; Vitest initially failed two tests because Testing Library renders were not cleaned up. Added `afterEach(cleanup)`; subsequent tests passed.
- Final `npm run typecheck`: passed.
- Final `npm test`: passed, 1 file / 4 tests.
- `npm run build` after implementation: passed (Vite 8.2.1, 30 modules). Build generated `dist` artifacts; I rebuilt once from the captured original App/SearchPanel baseline and restored the implementation, leaving `dist` at the original baseline asset `dist/assets/index-CBZaS9y9.js` rather than retaining generated implementation output. No other build artifact change is intended.
- `node .trial/sdk-runtime.ts`: passed, `SDK runtime exports resolved; no Vessel or connector was created.` This smoke probe is not live Engine verification.
- `npm run`: confirms scripts available are only `test`, `typecheck`, and `build`; there is no lint/format script or installed Biome executable. No lint/format check could run.
- `npm ls --depth=0`: failed as above. Direct `node -e` package metadata inspection confirmed installed versions.
- `git status`/`git rev-parse` fail because this fixture has no git metadata. No staged files or commits exist.
- `sha256sum -c .../sdk-source-checksums.sha256`: all source provenance hashes passed. Final hashes for allowed unchanged support files and supplied probes match captured values.
- Raw trial evidence is saved at `.trial/authorized-conversion-evidence.txt`; it records actual command results and explicitly distinguishes local SDK smoke from live Engine verification.

## Ownership, limitations, and rollback

`searchTickets` remains the application-owned call and its stub network boundary was not reimplemented or bypassed. Search-panel state stays inside the developer-authored component. The added Maelstrom instance statically registers the Vessel for a host Provider; this fixture's App does not mount a Provider/Chart or configure a live Engine connector, so the test proves local registration/rendering and search UI behavior, **not** hosted selection or live Engine behavior. The supplied simulated connector was not modified or used as a substitute for a live Engine. No provider credentials or external requests were involved.

Rollback: revert only `src/SearchPanel.tsx`, `src/App.tsx`, and `src/SearchPanel.test.tsx` to their captured baseline versions. Do not revert manifests, `src/search.ts`, supplied test connector/probes, or SDK files; they were not changed. `dist` was restored to the baseline build asset. The failed `npm ls` tree audit and absence of live Engine/lint infrastructure remain limitations, not passes.
