# Manual onboarding trial — blocked at fixture setup

## Result and scope

This was an execution attempt, not a hypothetical review. The canonical prompt read was `maelstrom-project-onboarding` v1.0.0. Its YAML compatibility declares `@maelstrom-co/react` 0.1.0-alpha.4. The supplied goal was to let the support queue be selected and presented as a developer-authored Vessel. Per the supervisor's direction, I stopped without source edits or adding a dependency: the disposable fixture does not have the SDK or React runtime installed. This is an environment/setup blocker, not a successful onboarding acceptance run and not evidence the prompt itself failed.

I inspected the fixture's `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, and `src/App.tsx`, and listed its project files. No lockfile exists. `node_modules` is a symlink to the read-only workspace repo's modules; I did not mutate it or install anything. There is no git repository in this fixture, so `git status`/a Git diff is unavailable. After the build generated `dist/`, I removed that generated output; the fixture's listed project files are back to the original set. No source files were changed.

## Observed app and candidates

`src/App.tsx` defines a local `tickets` array with two records and renders them in the support workspace. Existing UI is a heading `Support workspace`, explanatory text `Review the open support queue.`, and rows for `T-104` (“Cannot update billing address”, Open) and `T-105` (“Export is missing a column”, Waiting). `src/main.tsx` mounts `App` using React `createRoot`; Vite uses the React plugin. No router, other feature/state/data/network/server code, or tests are present in the fixture file set.

| Candidate | Evidence and plausible intent | Engine value / decision |
|---|---|---|
| Support queue (both displayed tickets) | `src/App.tsx`: the ticket array and its list rendering; a support operator might want to select and review the queue. | The queue is a coherent unit that can be presented together, unlike the individual presentation mechanics. It is the smallest plausible Vessel pilot, with its existing two rows and no invented actions or states. Not implemented because the SDK dependency is absent. |
| Heading, explanatory paragraph, list markup | `src/App.tsx`: static title, description, and `<ul>/<li>` rendering. | Incidental presentation, not independently meaningful selectable capabilities; keep internal to a queue Vessel. No edits made. |
| Individual ticket rows | `src/App.tsx`: two fixed records. | Displayed content inside the queue, not independent capabilities based on observed behavior. No separate Vessel/actions proposed. |

No Vessel variant/state/action contract was implemented or inferred beyond the existing queue's static displayed data. No new UI entry point was added. Existing heading, explanation, and rows remain untouched.

## Dependencies and setup evidence

Declared fixture dependencies are `react` `^19.0.0`, `react-dom` `^19.0.0`, `vite` `^8.0.13`, and `@vitejs/plugin-react` `^5.2.0`; dev dependencies include `typescript` `~5.9.2`, `@types/react` `^19.0.0`, and `@types/react-dom` `^19.0.0`. There are no declared `@maelstrom-co/*` dependencies. `npm ls` showed `typescript@5.9.3`, `vite@8.2.1`, and `@types/react@19.2.18` resolved through the shared modules symlink, but reported React and React DOM as unmet (`react@^19.0.0`, `react-dom@^19.0.0`) and no installed `@maelstrom-co/react`, `@maelstrom-co/react-realtime`, or `@maelstrom-co/core`. `npm ls @maelstrom-co/react @maelstrom-co/core --depth=0` returned empty / exit 1. Thus SDK declared and resolved versions are both absent; the canonical compatibility version must not be described as installed. Since there is no installed SDK implementation/types to validate against, no SDK API was selected or used.

## Commands and actual outcomes

- `pwd; git status --short; npm ls --depth=0` — confirmed fixture cwd; Git status unavailable because this is not a Git repository; npm dependency listing exited 1 with extraneous shared packages and unmet React/React DOM.
- `find . -maxdepth 2 -type f -not -path './node_modules/*' -print; npm ls @maelstrom-co/react @maelstrom-co/core --depth=0` — source/config files listed; SDK dependency result empty, command exited 1.
- `npm run typecheck` — passed (`tsc --noEmit`, exit 0). This is a TypeScript check only, not runtime or SDK integration evidence.
- `npm run build` — failed, exit 1: Vite/Rolldown could not resolve import `react` from `src/main.tsx`. The generated `dist/` output was removed after the check.
- `npm test -- --run` — not available; npm exited 1 because `package.json` has no `test` script.
- `npm ls react react-dom @maelstrom-co/react @maelstrom-co/react-realtime typescript vite @types/react --depth=0; readlink node_modules; ls -ld node_modules; ls package-lock.json bun.lock yarn.lock` — confirmed missing React/runtime and SDK entries, resolved tool/type versions above, and `node_modules` points to `/Users/javcab/Documents/maelstrom/maelstrom-prompting/node_modules`; no fixture lockfile. Command's final `ls` exited 1 because none of the queried lockfiles exist.
- `find . -maxdepth 2 -type f -not -path './node_modules/*' -print | sort; git status --short 2>&1 || true` — confirmed only original app/config files remain; Git status unavailable.

No test runner is configured. No lint/format script is configured. The checklist's UI/intent integration behavior could not be tested because no implementation was made. No live provider credentials or Engine access were used; live Engine verification is unavailable and was not claimed. No credentials are present in or added to browser code. Existing app has no observed server/auth/transport boundary; no such ownership was changed.

## Checklist and setup gap

- Dependency versions / absent SDK: reported above, including declared versus resolved evidence.
- `src/App.tsx`, queue and two ticket rows / incidental markup: inspected and documented above.
- Inspection completed before any editing; no material product decision was made on the user's behalf.
- SDK APIs not proposed because this fixture has no SDK to inspect or resolve.
- No actions, extra states, persistence, navigation, or live Engine response were invented or claimed.
- Existing queue rendering and its static content were preserved by making no source edits.
- Typecheck passed; build failed due missing React runtime; tests/lint unavailable; live service unrun; rollback described below.

## Required setup, rollback, remaining needs

Preparation must provide a runnable disposable fixture with its declared React and React DOM dependencies resolved and the approved SDK version available for inspection (or an explicit install/version selection). Do not rely on workspace symlink contents as project-installed dependencies. A rerun is required after that preparation gap is fixed to implement and exercise an API-compatible Vessel, validate the intent entry point and rendering, and complete checks. No network install was attempted.

There is no application integration to roll back because no source was edited. The only generated build output was removed. To revert the bounded integration after a future rerun, revert only the future trial's explicitly changed fixture source/config files; this run left the original files intact. Git-based diff/rollback commands are unavailable in this non-Git fixture.
