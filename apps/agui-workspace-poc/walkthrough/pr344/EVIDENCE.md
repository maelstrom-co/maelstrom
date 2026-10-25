# PR 344 walkthrough evidence

The film explains the hosted workspace integration and its library extraction. It does not replace the earlier bounded Journal and child-approval films.

| Chapter | Claim source |
| --- | --- |
| Intro and browser comparison | `apps/demo/src/components/home-page.tsx`, `workspace-protocol-select.tsx`, and `apps/demo/e2e/agui-workspace.e2e.ts` |
| Wire exchange | `packages/agui/src/contract.ts`, `server.ts`, and `workspace-client.ts` |
| Application settlement | `packages/client/src/lib/orchestrator/orchestrator.ts` and `connection-manager/application-settlement.ts` |
| Before extraction | PR commit `c1992ec15cb8`: `WorkspaceApplicationObserver` attached protocol acknowledgment through React. |
| Library ownership | `packages/agui/package.json`, `src/boundaries.test.ts`, and `src/workspace.test.ts` |
| Failure behavior | `packages/agui/src/workspace-error.ts` and lost-acknowledgment tests in `src/workspace.test.ts` |
| Verification | Uncached Nx checks and Playwright desktop/mobile checks for this branch. |
| Earlier live evidence | PR description records typed/GPT-Live application and a 16-minute rehello recovery at `c1992ec15cb8`. This predates extraction. |

The browser images use a deterministic local fixture and are labeled on screen. They do not establish model quality, performance gains, or live voice behavior for the current revision. Protocol and ownership scenes are diagrams of the implementation. The code panel contains real source excerpts with explicit gaps.

The reusable code eliminates application-specific acknowledgment wiring and permits a headless harness to exercise the same runtime. Comparative eval results remain future work. Unknown write outcomes stop continuation; there is no durable socket-loss reconciliation claim.
