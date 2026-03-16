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

Then merge the contents of [settings.local.json.example](settings.local.json.example) into your Claude Code settings.

## Governed Commands

- `/power-start`
- `/power-check`
- `/power-park`
- `/power-scope-override`
- `/power-review-parking`
- `/power-search-parking`
- `/power-compact-parking`
- `/power-time-override`
- `/power-shutdown`
- `/power-confirm-shutdown`

## Normal Use

Start the day with `/power-start`, then work in normal Claude chat. The `UserPromptSubmit` hook injects compact session context plus matching parked ideas so Claude can stay inside the approved mission or suggest the right parking/override command when you drift.

Parking retrieval is explicit:

- `/power-review-parking` shows all active parked ideas
- `/power-search-parking` finds related parked ideas
- `/power-compact-parking` merges multiple related parked ideas into one canonical parked entry after confirmation

## Enforcement Honesty

- Session lifecycle commands are hard because they call the local CLI directly.
- Prompt-layer guidance is soft because Claude hooks can inject context, but they cannot guarantee compliance outside the governed path.
- If you bypass the commands and work directly in freeform chat, Power Governor can only advise.
