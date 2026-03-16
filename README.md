# Power Governor

Local-first governor for AI work that limits branching, forces convergence, and protects your ability to stop.

## V1 Scope

V1 only proves the core loop:

- start a session
- enforce one mission and a small task cap
- park new scope
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
power out-of-scope --reason "Add weekly planning"
power shutdown --completed "Defined the state schema" --unfinished "Implement session start" --question "Should the lock timeout be configurable?"
power confirm-shutdown --reason "Closed cleanly"
```

## Claude Adapter

Install the Claude reference adapter:

```bash
./adapters/claude/install.sh
```

Then merge [adapters/claude/settings.local.json.example](/Users/sergeyzelvenskiy/stop-ai-burnout/adapters/claude/settings.local.json.example) into your Claude Code settings.
