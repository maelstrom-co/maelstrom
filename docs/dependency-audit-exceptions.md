# Dependency audit exceptions

CI and release builds audit the complete lockfile with `bun audit`.
There are no active advisory exceptions.

The [deepmerge exception](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) was retired after removing unused Nx/Jest scaffolding and its dependency chain.
Any future exception needs a documented reachability assessment, an owner, and a review date.

Historical tags also face current advisories when rebuilt for manual release recovery.
See [partial release recovery](../CONTRIBUTING.md#recovering-a-partial-release) before rebuilding a blocked tag.
