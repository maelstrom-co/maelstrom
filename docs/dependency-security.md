# Dependency security constraints

Run `bun audit` against the final lockfile before a release. The native audit
still reports findings; do not suppress them globally or label the audit clean.

## Reviewed updates

The launch preparation updates the affected transport, serialization, YAML,
HTTP, and image dependencies. The LiveKit worker uses the aligned 1.9.3 package
family and its required RTC peer. Additional overrides select these versions:

| Dependency | Version | Purpose |
| --- | --- | --- |
| `file-type` | 21.3.4 | Includes the upstream ASF parser and ZIP decompression fixes. Compiler download helpers retain the buffer-detection API. |
| `katex` | 0.18.2 | Prevents inherited settings from enabling trusted math output. |
| `qs` | 6.16.1 | Preserves array limits for bracketed comma lists and prevents parsed `isBuffer` keys from crashing serialization. |
| `valibot` | 1.4.2 | Formats validation errors for inherited Object property names without throwing. |
| `http-cache-semantics` | 4.3.0 | Removes the older transitive 4.2.0 copies. Keep the reviewed Got callers' caching disabled; the advisory remains disputed in the [upstream discussion](https://github.com/kornelski/http-cache-semantics/issues/56). |

The security regression suite resolves dependencies through their actual parent
packages. It covers the query-parser failures, validation error formatting,
math trust boundary, bounded malformed-file detection, and selector complexity.
Package-manager installs keep lifecycle scripts disabled during this review.

## Retained native findings

The latest audit reports one high and two moderate advisories. One moderate
entry matches a version that already contains the official security backport.

| Dependency | Assessment and constraint |
| --- | --- |
| `braces` 3.0.3 | No patched release is available for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Current callers use Verdaccio's fixed `*` directory patterns and docs-build configuration patterns. Keep patterns under maintainer control; do not accept arbitrary patterns in a request handler. Contributor builds have no npm publishing identity, and CI has a 30-minute job limit. |
| `sprintf-js` 1.0.3 | No patched release is available for [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The retained paths format Argparse CLI help and error templates through build and test tooling. Keep format strings in trusted command definitions; pass untrusted values as arguments. |
| `postcss-selector-parser` 6.1.5 | The audit's `<7.1.6` range includes the [official 6.1.5 security backport](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.5). Its parser contains the linear-time fix, and the complexity regression passes. The same regression rejects the unpatched 6.1.4 implementation. Retain the compatible 6.x backport and recheck the advisory metadata before release. |

## Bundled source-map assessment

Magicast 0.5.5 embeds source-map-js 1.2.1. Updating the separate source-map-js
dependency does not replace that bundle. The
[indexed source-map advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
affects reconstruction and indexed-source enumeration paths.

No path to these affected methods was found through the reviewed Magicast 0.5.5
public API flows. Public source-map composition queries the supplied map with
`originalPositionFor` and takes
generated positions from printed output. An independent source review and
bounded child-process probes completed with large section offsets and nested
indexed maps. This assessment excludes custom parser objects and manipulated
internal AST state. The bundled implementation remains unpatched. Keep it confined
to build/configuration tooling, and repeat this assessment when Magicast or its
source-map input paths change.

Review the retained entries by 2026-10-28, or before changing their input and
cache constraints. Live provider calls remain separate credential-dependent
checks. These results do not establish live publication or provider behavior.

