# Maelstrom skills

Use these skills to start a Maelstrom application or integrate one capability into an existing app. Start with `maelstrom`: it asks about your goal and starting point, inspects the project, and selects one procedure. Planning works before an SDK is installed. Implementation uses the exact installed SDK APIs.

## Install in your project

Run this from your application's root. Select your coding tool and Project scope:

```sh
npx skills@1.7.0 add maelstrom-co/skills --skill '*' --copy
```

Bun users can replace `npx` with `bunx`. Select the complete collection so the entry workflow can reach its procedures. Use `--agent codex`, `--agent claude-code`, `--agent cursor`, `--agent opencode`, or `--agent pi` to select a tool explicitly.

Then ask your coding tool:

> Use the maelstrom skill to help me get started. Ask what I want to build and whether this is a new app or an existing one. Plan one bounded integration. Do not edit files or install packages.

Authorize implementation when the plan matches your goal. The skill preserves existing application data, authorization, and behavior.

## Native plugins

Choose either the skills installer above or a native plugin installation to avoid duplicate skill names.

Claude Code:

```sh
claude plugin marketplace add maelstrom-co/skills
claude plugin install maelstrom@maelstrom-skills
```

Start with `/maelstrom:maelstrom`. The plugin contains the same skill folders.

Codex:

```sh
codex plugin marketplace add maelstrom-co/skills
codex plugin add maelstrom@maelstrom-skills
```

Cursor can import this repository's `.cursor-plugin/marketplace.json`. Its reviewed public marketplace listing is separate from repository installation.

Pi can install the repository directly:

```sh
pi install git:github.com/maelstrom-co/skills
```

## Included workflows

| Skill | Task |
| --- | --- |
| `maelstrom` | Choose the appropriate procedure. |
| `maelstrom-project-onboarding` | Start an app or plan its first integration. |
| `maelstrom-vessel-modeling` | Model one user-visible capability. |
| `maelstrom-react-migration` | Migrate a bounded React capability. |
| `maelstrom-debugging` | Diagnose a runtime failure. |
| `maelstrom-observability` | Plan event reporting. |
| `maelstrom-state-sync` | Update definitions or runtime state. |
| `maelstrom-voice-integration` | Plan optional voice input. |
| `maelstrom-voice-devtools` | Benchmark and test voice through a connected Voice DevTools desktop MCP. |

Each procedure includes its required references. SDK-specific guidance comes from the installed package's version-matched artifacts. This package contains instructions and references; it runs no installation hooks and bundles no MCP server.

## Update

For a skills CLI installation:

```sh
npx skills@1.7.0 update
```

Native plugins follow their host's marketplace update controls. Custom marketplace installation does not imply inclusion in a provider's reviewed public directory.

## Source and contributions

These files are generated from the [Maelstrom repository](https://github.com/maelstrom-co/maelstrom/tree/main/apps/docs/skills). `SOURCE.json` identifies the exact source revision. Submit changes and report problems in the [main repository](https://github.com/maelstrom-co/maelstrom/issues/new/choose). Maintainers regenerate this distribution after reviewing changes and bump the plugin version when packaged instructions change.

Read the [installation guide](https://docs.maelstrom-ai.co/agents/skills/) or run the [React starter](https://github.com/maelstrom-co/react-starter).
