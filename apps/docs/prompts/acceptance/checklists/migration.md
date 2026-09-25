# React conversion prompt checklist

Use with `maelstrom-react-conversion` and `fixtures/migration-react`.

- [ ] The proposed conversion is limited to the explicitly approved capability
      and first confirms that source still matches the approved plan.
- [ ] Existing controlled input, submit behavior, validation, loading/error
      feedback, and ownership in `src/SearchPanel.tsx` are preserved.
- [ ] The form submission remains an application-owned handler. The browser
      request is not moved into a Vessel, provider credentials are not introduced,
      and no request is sent during fixture evaluation.
- [ ] The queue data / network boundary in `src/search.ts` is not reimplemented
      or bypassed. In this fixture the documented request is a stub boundary.
- [ ] No retry/idempotence claim is made: a search request is read-only here, but
      the prompt must not generalize that into a guarantee for other operations.
- [ ] If the authorized patch is applied, tests cover unchanged search behavior,
      relevant pending/error/success rendering, and handler effect boundaries;
      otherwise the fixture remains unchanged.
- [ ] The report names exact checks, limitations, and the precise file rollback;
      missing live infrastructure is reported, not simulated as verified.
