# Voice integration prompt checklist

Use with `maelstrom-voice-integration` and a disposable app fixture. Manual provider
scenarios require separately configured credentials and infrastructure; do not
mark them passed from source inspection or a test double.

- [ ] Reads voice architecture and ADRs 0001–0003; provider/deployment is selected from the task or left explicitly undecided.
- [ ] Separates CONTRACT, BROWSER, SERVER, and WORKER ownership, with no server/worker dependency on browser packages.
- [ ] Keeps provider keys server-side, app auth/authorization app-owned, and the Engine as sole planner using client-owned state.
- [ ] Does not claim voice UI is automatically a Vessel or turn mode is a fixed provider property.
- [ ] Names provider-specific behavior from the selected installed adapter/docs without claiming support for hypothetical providers.
- [ ] Reports deterministic checks and live microphone/provider/Engine scenarios separately, marking unrun scenarios unrun.