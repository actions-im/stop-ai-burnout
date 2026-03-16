# Power Governor

Local-first governor for AI work that limits branching, forces convergence, and protects your ability to stop.

## V1 Scope

V1 only proves the core loop:

- start a session
- enforce one mission and a small task cap
- park new scope
- retrieve and compact parked ideas
- enforce a timebox
- require explicit overrides
- force shutdown

## V1 Constraints

- Claude is the only first-class adapter.
- Drift detection uses explicit events only.
- Recovery, weekly planning, and schedule features are deferred.

## Quick Start

Install dependencies:

```bash
npm install
npm run build
```

Use the CLI in the current repo:

```bash
power start --mission "Ship the CLI lifecycle" --task "Define state schema" --task "Implement session start"
power check --json
power park --idea "Support Codex adapter" --reason "Later"
power parking-review --json
power parking-search --query "adapter support" --json
power prompt-context --prompt "Can we also add adapter support?" --json
power shutdown --completed "Defined the state schema" --unfinished "Implement session start" --question "Should the lock timeout be configurable?"
power confirm-shutdown --reason "Closed cleanly"
```

## Claude Adapter

Install the Claude reference adapter:

```bash
./adapters/claude/install.sh
```

Then merge [adapters/claude/settings.local.json.example](adapters/claude/settings.local.json.example) into your Claude Code settings.

## Daily Flow

Start the governed session once:

```bash
/power-start
```

After that, work in Claude normally. The `UserPromptSubmit` hook adds mission, task, and matching parking-lot context so Claude can:

- proceed normally for approved work
- ask one clarification question if relevance is ambiguous
- suggest `/power-park`, `/power-scope-override`, `/power-review-parking`, or `/power-search-parking` when the request looks out of scope

Use explicit review commands when you want to revisit parked ideas. The hook does not automatically re-scope work or mutate session state.
