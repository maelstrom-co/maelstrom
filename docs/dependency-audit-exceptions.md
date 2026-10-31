# Dependency audit exceptions

CI and release builds audit the complete lockfile with `bun audit`.
There are no active workspace audit exceptions.

The [deepmerge exception](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) was retired after removing unused Nx/Jest scaffolding and its dependency chain.
Any future exception needs a documented reachability assessment, an owner, and a review date.

Historical tags also face current advisories when rebuilt for manual release recovery.
See [partial release recovery](../CONTRIBUTING.md#recovering-a-partial-release) before rebuilding a blocked tag.

## SDK consumer dependencies

`@maelstrom-co/realtime-livekit-agent` pins `@livekit/agents` 1.9.3.
That package installs `@livekit/throws-transformer` 0.1.8, whose separate
`throws-check` command depends on glob 13 and minimatch 10.

| Advisory | Trigger | Voice worker assessment |
| --- | --- | --- |
| [Glob cancellation](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | An asynchronous filesystem walk continues after its abort signal. | The worker imports promise and type helpers. The separate CLI uses synchronous globbing without an abort signal. |
| [Minimatch amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249) | A hostile glob pattern expands during level-two optimization. | The worker does not run the CLI. A caller invoking `throws-check` with a hostile pattern can reach this path. |

The workspace resolves patched glob and minimatch versions. Its compatibility
patches preserve documentation discovery, project selection, and local-registry
package rules. npm does not inherit overrides from an installed dependency,
so an SDK consumer can still report these two moderate advisories.

The follow-up is a compatible LiveKit family release that updates or removes
the CLI dependency chain. Version 1.9.5 retains the same transformer dependency.
Verify the packed SDK in a fresh consumer without workspace overrides when
reviewing a replacement.

Owner: Nacho. Review by: 2026-11-07.
