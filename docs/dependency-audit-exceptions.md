# Dependency audit exceptions

CI and release builds run `bun scripts/audit-dependencies.ts` after a frozen install. The script audits the complete lockfile.

## Patched picomatch installations

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) affects glob parsing in workspace dependencies and starter build tools. The starter production dependency graph excludes picomatch. The workspace production graph includes it. The backport applies to every locked copy, independent of how a caller obtains its patterns.

The patches adapt the library changes in upstream [4.x PR 262](https://github.com/micromatch/picomatch/pull/262/commits/3222059ac27492d9c0147fee5c65f751bbd851ab) and [2.x PR 263](https://github.com/micromatch/picomatch/pull/263/commits/9ca61909ab0ec680953e21bac80a6e825e1ede81). These are proposed upstream changes. The 4.0.4 patch applies the same logic to its older parser layout. All four keep the new wildcard guard active when a caller disables the legacy recursion limit. The local adaptation preserves hyphenated literal text with Unicode regex flags. Rewritten tokens retain their wildcard information for enclosing groups. Complex repeated patterns can fall back to literal matching.

Bun reports the original npm versions after patching. Before omitting this single advisory, the audit command checks the manifest and package contents against pinned SHA-256 fingerprints for every installed picomatch copy. Unknown versions, modified contents, and missing locked versions fail verification. Other advisories still fail the audit. The exported starter includes its own patch and this verifier.

If a local isolated store retains an obsolete version, run the check in a fresh checkout with a frozen install. Verification also checks stale copies still on disk.

Owner: Nacho. Review by: 2026-11-25. Replace the backports and remove this exception when supported patched releases cover both major lines. Recheck upstream review status before extending it.

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
