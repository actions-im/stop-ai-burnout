# Claude Reference Adapter

This adapter makes Claude the first-class governed path for Power Governor v1.

## What It Installs

- custom slash commands under `.claude/commands/power/`
- a hook script under `.claude/hooks/power-session-guard.sh`
- an example `settings.local.json` hook snippet

## Install

Run:

```bash
./adapters/claude/install.sh
```

Then merge the contents of [settings.local.json.example](/Users/sergeyzelvenskiy/stop-ai-burnout/adapters/claude/settings.local.json.example) into your Claude Code settings.

## Governed Commands

- `/power-start`
- `/power-check`
- `/power-park`
- `/power-out-of-scope`
- `/power-scope-override`
- `/power-time-override`
- `/power-shutdown`
- `/power-confirm-shutdown`

## Enforcement Honesty

- Session lifecycle commands are hard because they call the local CLI directly.
- Prompt-layer warnings are soft because Claude hooks can warn, but they cannot guarantee compliance outside the governed path.
- If you bypass the commands and work directly in freeform chat, Power Governor can only advise.
