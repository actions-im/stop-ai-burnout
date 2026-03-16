#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
commands_src="$repo_root/adapters/claude/commands"
hooks_src="$repo_root/adapters/claude/hooks"
commands_dest="$repo_root/.claude/commands/power"
hooks_dest="$repo_root/.claude/hooks"

mkdir -p "$commands_dest" "$hooks_dest"
cp "$commands_src"/*.md "$commands_dest"/
cp "$hooks_src"/power-session-guard.sh "$hooks_dest"/

echo "Installed Claude adapter assets into $repo_root/.claude"
echo "Merge adapters/claude/settings.local.json.example into your Claude Code settings."
