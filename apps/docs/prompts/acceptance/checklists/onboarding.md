# Onboarding prompt checklist

Use with `maelstrom-project-onboarding` and `fixtures/onboarding-react`.

- [ ] Exact declared and resolved Maelstrom dependencies are reported; absence is
      not described as an installed dependency.
- [ ] The inventory cites `src/App.tsx` and identifies the support queue and its
      two displayed tickets; it distinguishes the queue from incidental markup.
- [ ] The prompt performs read-only inspection and does not edit before finishing
      inspection; implementation is limited to the supplied product goal and
      stops if that goal requires an unapproved material decision.
- [ ] Proposed APIs are evidenced from the installed version or explicitly
      deferred until the approved integration installs/selects a version.
- [ ] It does not invent actions, states, data persistence, navigation, or claim
      live Engine verification; single-Variant/no-Action remains acceptable.
- [ ] Any proposed implementation preserves existing support-queue rendering and
      keeps auth/transport ownership outside the Vessel.
- [ ] Typecheck, tests, lint, live-service checks, and rollback are reported with
      actual commands/outcomes or explicitly marked unrun.
