# Dependency audit exceptions

Audit the complete lockfile. Exclude only the advisory IDs listed here.
Every other advisory remains blocking, regardless of severity.

## deepmerge: GHSA-gcqx-w48m-w2h4

- Advisory: [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
- Package: `deepmerge@4.3.1`.
- Owner: Nacho Vazquez.
- Reviewed: 2026-10-28.
- Review again by: 2026-11-11.

The defect can change the prototype of an object returned by a merge.
The reviewed advisory lists no patched version.

The only dependency path reaches `deepmerge` through `jest-config@30.4.2`,
`@nx/jest@24.0.2`, and root development tooling. `@nx/plugin` also depends on
`@nx/jest`. The vulnerable calls merge Jest configuration.

This repository registers Vitest, with no Jest targets or configuration.
The current build, test, and release commands do not invoke those merge paths.
Public SDK manifests and emitted JavaScript contain no `deepmerge` dependency
or implementation. The publish job installs no workspace dependencies.

CI and release builds use `bun audit --ignore GHSA-gcqx-w48m-w2h4`.
Run `bun audit` without that flag to inspect the original finding.
This exception defers an unreachable development path; it does not fix the library.

Reassess before enabling Jest, changing the dependency chain, or introducing
`deepmerge` into a runtime path. Remove the exception when a patched release
is available or the dependency is removed. Recheck upstream by the review date.
