# Canonical current scenario definitions

`v1/index.json` is the ordered source of all **155 current scenarios**. It contains
152 `snapshot` entries and three `case` entries. Snapshots live in
`v1/snapshots/<id>.json`; case entries resolve through fixed code-owned loaders:

- `variant` → `cases/v1/scripted-variant.json`
- `preserve` → `cases/v1/planner-preserve.json`
- `generate-content` → `cases/v1/planner-deferral.json`

The three case payloads are not copied here. The separate `cases/v1` registry still
has 36 cases, 28 fixtures and 25 execution profiles. Moving scenario definitions
into JSON creates neither independent candidate fixtures nor successful model
evaluations, and does not complete legacy partial/deferred obligations.

## Data contract

Each snapshot contains `schemaVersion: 1`, `source` provenance (the pre-migration
registry revision/path/scenario ID), and the full `scenario` object. `Scenario`
fields remain `id`, `suite`, `title`, `request`, optional `history`, `expected`, and
optional `spatial`. The 97 development and 58 holdout labels, nine histories, all
66 explicit spatial flags, and all expectation data are retained. `holdout` is a
historical suite label, not a claim of secrecy or untouched evaluation data.

`src/core/scenario-registry.ts` validates the manifest and every snapshot before
exporting anything. Expectations retain the existing scorer's language, including
all arrangement rules, action parameters, retained Instances, asks, unmatched
options, gate expectations and deferral metadata. It neither tightens behavioral
oracles nor applies defaults or transforms. Protocol ChartRequest parsing must be
lossless: unknown/stripped fields reject. Runtime selection preserves manifest
order; it does not sort, rebuild requests from demo catalogs, or fall back to
TypeScript definitions. Execution, profile composition and scoring remain code.

Paths come from validated IDs beneath this fixed directory, never data-selected
URLs. The v1 manifest requires 155 unique entries and all three distinct case
references. Missing or swapped files, unsafe IDs, unknown fields, symlinks,
nonregular files and oversized data fail closed. Individual files are capped at
64 KiB (largest initial pretty snapshot is under 27 KiB); the registry budget is
8 MiB (initial pretty snapshots total about 4 MiB). Case references count their
64 KiB upper bounds toward that budget. `cases/v1` limits are unchanged.

## Editing and verification

Edit the authoritative JSON rather than regenerating it from helper functions.
Frozen catalogs require explicit updates when demo definitions change. Additions
or removals require deliberately updating the manifest cardinality and parity
controls. `request` and other exported builders remain available for tests and
manual samples; they no longer construct the registered scenario data.

The initial migration was checked against a pre-edit V8 snapshot with deep equality
of all 155 values in order, after first proving JSON round-trip equality. Regression
tests pin the pre-migration canonical digest (including array order), suite counts,
optional fields and case-source identity. Negative tests exercise strict parsing,
paths, file/aggregate bounds and absence of fallback; controlled JSON edits prove
requests and expectations remain data-driven.

```sh
bun --no-env-file test --conditions=@maelstrom-co/source packages/evals/src/core/scenario-registry.test.ts
bun --no-env-file --conditions=@maelstrom-co/source tools/evals-offline/inventory-cli.ts
bunx nx run-many -t test,typecheck,check -p @maelstrom-co/evals,evals-offline --skip-nx-cache
```

The inventory's JSON-source classification derives from the same loaded manifest:
155 JSON-backed, zero TypeScript-backed. Its eight case-level references to five
scenario IDs are a separate dimension; 150 IDs without a case-level link are not
150 uncovered or unmigrated scenarios. Source format is not evaluation coverage.
