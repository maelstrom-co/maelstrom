# SDK scaffold prompt checklist

Use with `maelstrom-sdk-scaffold` and a disposable application that has an existing
UI entrypoint and test setup. This is a manual prompt outcome checklist, not an
automated evaluator.

- [ ] Reports resolved Maelstrom package versions from the fixture's manifest and lockfile.
- [ ] Names actual exports/types/source or matching docs for every proposed SDK symbol; missing symbols are reported rather than guessed.
- [ ] Keeps React behavior in the React integration and does not add React imports to framework-neutral client code.
- [ ] Preserves the fixture's existing UI and app-owned data/effect boundaries; scope stays within the supplied goal.
- [ ] Never exposes provider keys in browser code and does not claim live Engine behavior from local tests.
- [ ] Separates changed files, deterministic checks actually run, and infrastructure checks left unrun.