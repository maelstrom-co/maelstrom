# React inventory prompt checklist

Use with `maelstrom-react-inventory` and an isolated copy of the onboarding
React workspace. The task is read-only: any fixture edit is a failure.

- [ ] The workspace inventory cites `package.json`, `src/main.tsx`,
      `src/App.tsx`, `index.html`, and `vite.config.ts` where relevant, and
      reports that no router, state/data layer, test suite, or Maelstrom
      integration is evidenced rather than assuming one exists.
- [ ] It identifies the displayed support queue and tickets `T-104` and
      `T-105`, distinguishes the capability from incidental markup, and ties
      conclusions to actual source evidence.
- [ ] It distinguishes declared dependency ranges from resolved versions and
      reports Maelstrom SDK package/source/version evidence as unavailable in
      this fixture instead of inventing APIs or installing packages.
- [ ] The capability inventory states plausible user intent, Engine value,
      and expose/internal decision; the proposed smallest pilot is the
      developer-authored support queue, not model-generated JSX.
- [ ] The behavior/ownership and implementation plan preserve existing
      rendering and app ownership, invent no actions, persistence, routing,
      network behavior, or unsupported states, and identify missing evidence.
- [ ] It gives bounded tests/checks and rollback steps, explicitly marks them
      unrun for this read-only planning task, and does not claim live Engine
      verification.
- [ ] The temporary workspace is byte-for-byte unchanged after the trial.
