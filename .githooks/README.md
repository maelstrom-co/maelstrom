# Git hooks

Versioned hooks for this repo. They are **opt-in** — Git does not run them until
you point `core.hooksPath` here (a per-clone local setting):

```bash
git config core.hooksPath .githooks
```

Requires Git 2.9+.

## `prepare-commit-msg`

Appends your DCO `Signed-off-by` trailer to every commit message, so you don't
have to pass `-s` each time (see [CONTRIBUTING.md](../CONTRIBUTING.md) → DCO).
It uses your `git config user.name` / `user.email`, is idempotent (no duplicate
trailer if one is already present), and is skipped for merge and squash commits.

To stop using the bundled hooks: `git config --unset core.hooksPath`.
