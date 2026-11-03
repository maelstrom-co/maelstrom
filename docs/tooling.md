# Code checks

`bun run check` combines native Nx linting and formatting commands. Both checks
leave source files unchanged. `bun run format` applies formatting and import
sorting.

| Target | Execution | Cache |
| --- | --- | --- |
| `lint` | The official Nx Oxlint executor batches projects into one process. | Each project has its own entry. |
| `nx format:check --all` | Nx invokes Oxfmt once across the workspace. | The formatter command does not use the Nx task cache. |
| `bun run check` | Runs all lint targets and the native formatter check. | Lint targets hold the cached results. |

Local jj and code-index metadata are ignored because they change independently
of source files. An explicit root lint target covers scripts, `.github`, shared
tools, and the root Vitest configuration. It excludes tool project roots to
avoid checking their files twice. The official plugin infers other lint targets.
Server and worker packages extend the root lint config and restrict browser imports. The
layer-boundary tests check both the configuration and actual linter diagnostics.

## Rule differences from Biome

The configuration maps the previous blocking recommendations to native Oxlint
rules where their behavior fits this codebase. The presets are not equivalent.
Biome's nonblocking informational suggestions are omitted because Oxlint has no
matching information level; warnings fail this repository's checks.

| Difference | Configuration and reason |
| --- | --- |
| TypeScript declaration merging | `no-redeclare` stays enabled for JavaScript. It is disabled for TypeScript because it rejects valid type/value pairs. Typecheck still checks invalid declarations. |
| `void` in generic calls and cleanup callbacks | `no-invalid-void-type` is disabled because it rejects valid Effect and callback signatures. |
| Semantic HTML roles | `prefer-tag-over-role` is disabled because it rejects valid `role="status"` live regions. Other accessibility checks remain enabled. |
| Builtin constructors | `new-for-builtins` is disabled because it also rejects valid `Array()` and `Object()` calls. The native nonconstructor check remains enabled. |
| Declaration order | Deferred callback references are allowed. Direct same-scope reads remain checked. |
| Empty classes and interfaces | Empty and constructor-only classes are allowed. A single inherited interface is allowed. Static-only wrappers remain checked. |
| Import type syntax | The check accepts inline type imports. Type information still comes from the existing TypeScript checks. |

The initial native rule set has no dedicated counterpart for these former
recommendations: SVG titles, empty type parameters, flat-map identity, `this` in
static initializers, redundant `continue`, redundant `String.raw`, simple numeric
keys, mismatched string-case comparisons, dynamic namespace access, implicit-any
`let`, redundant strict directives, suspicious JSX semicolons, duplicate
parameters, and octal escapes. Parsing or typecheck catches some cases, but does
not establish identical lint coverage. Oxlint also does not replace Biome's
semantic JSON lint rules; included JSON configuration files receive formatting
and syntax checks.

Type-aware counterparts for optional chaining style, literal property keys,
export type syntax, and strict `void` returns require a separate type-aware
linting setup. They are not enabled by this migration.

Astro source line breaks can change text nodes. Explicit spaces and `set:text`
preserve word boundaries and numeric-only text through formatting.

## Scoped exceptions

- The two PostHog components retain the provider's initialization snippet. Three
  syntax-style rules are disabled for those files.
- Fixed slots in the website's presentation grids retain positional keys. The
  array-index rule is disabled only for the listed presentation components.
- React dependencies that intentionally use session epochs, serialized option
  keys, or stable refs carry local suppressions with their reasons. Suppressions
  for dependency arrays must appear immediately above the array's line.
- Tests may use non-null assertions for values the scenario requires. Throwing
  thenable probes retain local suppressions because they test error isolation.

Oxlint checks JavaScript in Astro files but does not lint their templates.
Oxfmt formats Astro through the separately installed compiler package. The
formatter keeps the previous file scope: Markdown, CSS, generated output, and
other previously unformatted file types are excluded. Recorded JSON fixtures,
cases, and scenarios keep their generated layout to preserve byte budgets and
source hashes.

The exported starter has its own frozen lockfile and standalone Oxc configs.
Its consumer check validates installation, lint, format, types, tests, build,
and browser behavior independently of the workspace.

## CI selection and artifacts

CI checks formatting once, then selects affected tasks. SDK validation declares
its package builds and
reads their JavaScript outputs. Docs link validation declares the docs build and
reads the complete output. These prerequisites restore or produce artifacts even
when task selection skips unrelated projects.

Tests and typechecks cache their source inputs and runtime versions. Structural
suites declare files outside their import graph explicitly; root structural tests
conservatively cover the whole workspace. Explicit uncached evaluation-tool targets retain their policy. The standalone starter
check remains uncached because it also checks current dependency advisories.
Browser installation remains unconditional because that check runs browser tests.
