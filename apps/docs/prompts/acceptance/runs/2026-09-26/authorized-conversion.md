# Manual acceptance trial: React conversion

## Outcome

**Stopped before editing.** The fixture does not provide the installed SDK/API or the app/test integration needed to safely implement the approved conversion. I did not invent the API integration, add dependencies, or change fixture files.

## Canonical instruction and plan

- Canonical prompt: `maelstrom-react-conversion`, version `1.0.1`; compatibility metadata names `@maelstrom-co/react` `0.1.0-alpha.4`.
- Followed the bounded plan: only `src/SearchPanel.tsx` and a directly necessary demonstrated local registration/test seam could be changed; no requests, dependency installation/upgrades, or wider scaffolding.
- Read the migration checklist. It calls for preserving the controlled input and search behavior/ownership, adding relevant tests if implementing, and reporting missing live infrastructure rather than simulating verification.

## Inspected fixture and observed behavior

Fixture files present: `src/SearchPanel.tsx` and `src/search.ts`; the `node_modules` entry is a symlink to the source repository's node_modules. No package manifest, lockfile, test files, registration seam, or git metadata exists in the fixture.

`SearchPanel` owns `query`, nullable `results`, nullable `error`, and `pending` state. The input is controlled. Submit is disabled when pending or when `query.trim()` is empty. Submit prevents default, sets pending, clears the prior error, calls the application-owned `searchTickets(query)`, sets results on success, displays `Search is temporarily unavailable.` on rejection, and clears pending in `finally`. It renders pending button text, an alert for errors, and a status with result count. `src/search.ts` rejects a blank trimmed query and otherwise returns a stubbed result; no request was sent.

## SDK evidence and blocker

The fixture has no `@maelstrom-co/react` installation: `node_modules/@maelstrom-co/react/package.json` is absent and `node_modules/@maelstrom-co` does not exist. There is no fixture package manifest or lockfile from which to establish declared/resolved dependency versions or execute project checks.

For SDK evidence only, I read the read-only repository source's `packages/react/package.json` and `packages/react/src/index.ts`. The source package declares `@maelstrom-co/react` `0.1.0-alpha.4`, with `@maelstrom-co/client` and `@maelstrom-co/protocol` each declared at `0.1.0-alpha.4`; `index.ts` exports `defineVessel` from protocol and the `vessel` API. These source declarations do not constitute an installed fixture SDK or resolved fixture dependency evidence, and there is no local application registration surface to integrate with. I did not treat source-repository SDK tests or type declarations as proof that this fixture can compile against them.

This meets the canonical prompt's stop condition for missing installed-SDK/API and fixture evidence. No conversion implementation or tests were added.

## Commands and checks

- `pwd; find . -maxdepth 3 -type f -print; find node_modules -maxdepth 3 -type f -print | head -100; git status --short --branch` — listed only the two `src` files (the max-depth node_modules scan did not find SDK source); `git status` failed because the fixture is not a git repository.
- `ls -la; ls -la node_modules/@maelstrom-co 2>&1; find node_modules -maxdepth 2 -iname '*maelstrom*' -print; node --version; npm --version` — no `@maelstrom-co` package in linked node_modules; Node `v24.18.0`, npm `11.16.0`.
- `find /Users/javcab/Documents/maelstrom/maelstrom-prompting -maxdepth 2 \( -name 'package.json' -o -name '*lock*' \) -print | head -50` — read-only SDK evidence; found repository `package.json` and `bun.lock` (not fixture dependency resolution).
- `grep` for `@maelstrom-co|Vessel|Variant` in fixture — no matches.
- Project typecheck, tests, lint/format: **not run**; no fixture manifest/scripts/tests and no installed SDK. Live Engine behavior: **not run**; no Engine configuration, and the trial required no request.

## Diff, ownership, risks, rollback

- Fixture changes: none. Tests added/updated: none. No request sent, credentials introduced, or app-owned search handler changed.
- Diff: none; cannot inspect a git diff because this fixture is not a git repository. The inspected source shows the request boundary remains in `searchTickets`.
- No staged files: no git repository and no files were changed.
- Rollback: no rollback action is needed; there are no fixture changes to revert.
- Residual blocker: without an installed SDK and a demonstrated local registration/test seam, safe conversion and validation cannot be established within the authorization. No claims are made about typecheck, tests, lint, format, or live service behavior.
