# React inventory prompt checklist

Use with `maelstrom-react-inventory` and `migration-inventory` scratch workspace.
The case inventories the same unchanged SearchPanel input as the paired
implementation trial; any fixture edit is a failure.

- [ ] The report cites `package.json`, `src/main.tsx`, `src/App.tsx`,
      `src/SearchPanel.tsx`, `src/search.ts`, `index.html`, and `vite.config.ts`
      where relevant. It reports that no router or server/API implementation is
      evidenced rather than assuming one exists.
- [ ] It distinguishes declared app dependency versions from installed
      resolutions and reports the exact local workspace Maelstrom SDK package
      versions and source revision. The SDK is bundled from the checked-out
      workspace build, not fetched from a registry.
- [ ] It identifies the support search capability and cites the controlled query,
      disabled empty submit, pending state, validation boundary, local stub result,
      and error/success presentation from the actual component and search source.
- [ ] The capability inventory states plausible user intent, Engine value, and
      expose/internal decision; it proposes only a bounded developer-authored
      capability, not model-generated JSX.
- [ ] The behavior/ownership and implementation plan preserve current rendering,
      controlled input, and app-owned request boundary; they invent no routes,
      remote service, credentials, persistence, retries, or unsupported states.
- [ ] It gives bounded tests/checks and rollback steps, marks execution unrun for
      this read-only planning task, and does not claim live Engine verification.
- [ ] `src/SearchPanel.tsx` and `src/search.ts` checksums match the paired
      `migration-conversion` input, and the inventory scratch project is unchanged
      after the trial.
