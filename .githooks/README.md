# Git hooks

Versioned hooks for this repo. They are **opt-in** — Git does not run them until
you point `core.hooksPath` here (a per-clone local setting):

```bash
git config core.hooksPath .githooks
```

Requires Git 2.15+.

> **Note:** these hooks only run for `git commit`. Tools that don't invoke the
> `prepare-commit-msg` hook — jj (jujutsu), JetBrains IDEs, lazygit, Sourcetree —
> won't sign off automatically. See [`SIGN-OFF-TOOLS.md`](./SIGN-OFF-TOOLS.md)
> for each tool's native option, or use `git commit -s`.

## `prepare-commit-msg`

Appends your DCO `Signed-off-by` trailer to every commit message, so you don't
have to pass `-s` each time (see [CONTRIBUTING.md](../CONTRIBUTING.md) → DCO).
It uses your `git config user.name` / `user.email`, is idempotent (no duplicate
trailer if one is already present), and is skipped for merge and squash commits.

To stop using the bundled hooks: `git config --unset core.hooksPath`.
