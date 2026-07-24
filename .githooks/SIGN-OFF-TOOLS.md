# DCO sign-off across git tools

Every commit needs a DCO `Signed-off-by` trailer (see
[CONTRIBUTING.md](../CONTRIBUTING.md) → DCO). The bundled
[`prepare-commit-msg`](./README.md) hook adds it automatically — but only in
tools that actually run that hook on commit. This page covers the tools that
don't, and each one's native way to sign off instead.

## Does the hook fire?

| Tool | Runs `prepare-commit-msg`? | Native auto sign-off | Persistence |
|------|:--:|------|------|
| `git commit` | ✅ | `git commit -s`, or the bundled hook | flag / hook |
| Graphite (`gt`) | ✅ | bundled hook (runs git hooks by default) | automatic |
| GitKraken | ✅ | bundled hook (runs hooks by default) | automatic |
| GitHub Desktop | ✅ | bundled hook¹ | automatic |
| VS Code (built-in git) | ✅ | bundled hook² | automatic |
| magit | ✅ | bundled hook | automatic |
| **jujutsu (jj)** | ❌ never runs git hooks | `templates.commit_trailers` config | **set once, persistent** |
| **lazygit** | ❌³ | `git.commit.signOff: true` in `config.yml` | **set once, persistent** |
| **JetBrains IDEs** | ❌ (runs only `pre-commit` / `commit-msg`) | "Sign-off commit" checkbox | per-commit, default off |
| **Sourcetree** | ❌ | "Sign-Off" checkbox in commit dialog | per-commit, default off |

¹ GitHub Desktop uses real git and runs hooks, but has known PATH/shell-env
issues on some setups; if the hook silently no-ops, enable *Settings → Git →
Hooks → "Load Git hook environment variables from shell"*.
² VS Code fires `prepare-commit-msg` *after* you type the message, so the
trailer still lands in the commit; it just can't pre-fill the message box.
³ lazygit support for `prepare-commit-msg` is in progress upstream but not yet
released — use the `signOff` config below regardless.

## Native config per tool

### jujutsu (jj ≥ 0.24)

Set the built-in sign-off trailer once per repo (drop `--repo` for user-global):

```bash
jj config set --repo templates.commit_trailers 'format_signed_off_by_trailer(self)'
```

### lazygit

In `~/.config/lazygit/config.yml`:

```yaml
git:
  commit:
    signOff: true
```

### JetBrains IDEs (IntelliJ, WebStorm, …)

No always-on setting. In the Commit tool window, open the gear / commit-options
menu (⌃O) and tick **Sign-off commit**. The toggle is sticky in the UI but must
be verified each commit — there is no project-level "always sign off".

### Sourcetree

Tick the **Sign-Off** checkbox in the commit dialog. It defaults off and there
is no persistent/always-on mode, so tick it every commit.

## No universal git setting

Git has **no** built-in "always sign off" config for `git commit`:

- There is no `commit.signoff` option — sign-off on a normal commit only comes
  from the per-invocation `-s` / `--signoff` flag or a hook.
- `format.signoff` applies only to `git format-patch` / `git send-email`, **not**
  `git commit`, so it does nothing for interactive commits.
- `commit.template` can pre-seed message text, but it can't compute your real
  `Name <email>` the way `-s` does, lands as body text rather than a parsed
  trailer, and the GUI/TUI tools that skip `prepare-commit-msg` bypass the
  template too.

The two git-native mechanisms — `-s` and the `prepare-commit-msg` hook — are
exactly the two some front-ends skip, which is why there is no single
front-end-agnostic switch. When in doubt, `git commit -s` from a real git CLI
always works.
