# Dependency security constraints

The 2026-10-21 verification found vulnerabilities in the locked dependency graph.
The preparation updates the affected TanStack transport, Seroval, YAML parsers,
HTTP middleware, and other available compatible patches. The LiveKit worker
uses an aligned 1.9.3 package family and its required RTC peer so consumers also
receive the patched image dependency. Live provider calls remain a separate
credential-dependent check.

The native audit still reports advisories. Do not label it clean or suppress
them globally. Run `bun audit` again against the final lockfile before launch.

| Retained dependency | Constraint and follow-up |
| --- | --- |
| `braces` | No patched release was available during review. It parses build-tool patterns. Contributor builds can already execute code and have no npm publishing identity; CI now has a 30-minute job limit. Do not accept arbitrary patterns in a public request handler. |
| `http-cache-semantics` | The reviewed Got callers leave caching disabled. Keep it disabled; do not introduce a cache shared between users without resolving the advisory. A newer version alone is not proof of a verified fix. |
| Magicast's bundled source-map implementation | Magicast 0.5.5 still embeds an older implementation. Updating the separate `source-map-js` dependency does not replace that bundle. The affected source-map reconstruction path remains unverified; keep it confined to build/configuration tooling and review the bundle before accepting external source maps. This risk is additional to the native audit output. |
| `file-type`, `katex`, `postcss-selector-parser`, `qs`, `sprintf-js`, `valibot` | Lower-severity findings remain in upstream-constrained or unpatched versions. Track their affected operations before enabling new input paths; do not force incompatible major upgrades only to change the audit count. |

The maintainers should review these retained entries by 2026-10-28, or before
changing the stated input and cache constraints. This records the remaining
risk; it does not turn an untested path into a passed check.

