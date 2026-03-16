#!/usr/bin/env bash
set -euo pipefail

workspace="${CLAUDE_PROJECT_DIR:-${POWER_WORKSPACE:-$(pwd)}}"
tool_origin="${POWER_TOOL_ORIGIN:-claude}"
hook_input="$(cat)"

if [ -z "$hook_input" ]; then
  exit 0
fi

if ! command -v power >/dev/null 2>&1; then
  exit 0
fi

prompt="$(
  printf '%s' "$hook_input" | node -e '
    let data = "";
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(data);
        process.stdout.write(typeof payload.prompt === "string" ? payload.prompt : "");
      } catch {
        process.stdout.write("");
      }
    });
  '
)"

if [ -z "$prompt" ]; then
  exit 0
fi

prompt_context_json="$(
  POWER_WORKSPACE="$workspace" POWER_TOOL_ORIGIN="$tool_origin" \
    power prompt-context --prompt "$prompt" --json 2>/dev/null || true
)"

if [ -z "$prompt_context_json" ] || [ "$prompt_context_json" = "null" ]; then
  exit 0
fi

printf '%s' "$prompt_context_json" | node -e '
  let data = "";
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => {
    const context = JSON.parse(data);
    const contextLines = [
      "Power Governor Context",
      `Mode: ${context.mode}`,
      `Mission: ${context.mission}`,
      "Approved Tasks:",
      ...context.approvedTasks.map((task) => `- ${task}`),
      "Matched Parked Ideas:",
    ];

    if (context.parkingMatches.length === 0) {
      contextLines.push("- No matched parked ideas.");
    } else {
      contextLines.push(
        ...context.parkingMatches.map(
          (match) =>
            `- [${match.entryId}] ${match.idea} | reason: ${match.reason} | ideaOverlap=${match.ideaOverlap} reasonOverlap=${match.reasonOverlap}`,
        ),
      );
    }

    if (context.hasMore) {
      contextLines.push(
        `- ${context.totalMatchCount - context.parkingMatches.length} more matches available via /power-search-parking.`,
      );
    }

    const policyLines = [
      "Power Governor Policy",
      "- If the prompt is directly required to complete an approved task, answer normally and do not mention Power Governor.",
      "- If task relevance is ambiguous, ask exactly one clarifying question.",
      "- If the prompt appears out of scope, do not execute it. Briefly explain that it appears outside todays mission and suggest /power-park, /power-scope-override, /power-review-parking, and /power-search-parking.",
      "- Hook guidance is advisory only. Do not claim that scope, drift, or mode changed unless an explicit Power Governor command was run.",
    ];

    const response = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: [...contextLines, "", ...policyLines].join("\n"),
      },
    };

    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
'
