# Upgrade prompt checklist

Use with `maelstrom-upgrade` and a disposable application snapshot with recorded
source and target package versions. No live services are required.

- [ ] Establishes exact resolved source versions from manifest and lockfile.
- [ ] Maps affected symbols to current usages and target declarations/source/docs; does not infer from tags or unrelated current docs.
- [ ] Reports unavailable target evidence as an explicit limitation before claiming compatibility.
- [ ] Limits edits to the authorized package/source changes and maintains a reversible lockfile state.
- [ ] Distinguishes checks actually run from suggested or unrun checks; does not claim provider/Engine checks absent evidence.
- [ ] Provides a rollback procedure and names compatibility gaps.