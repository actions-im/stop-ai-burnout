#!/usr/bin/env node

import {
  PowerGovernorError,
  confirmShutdown,
  expireTimebox,
  getSessionState,
  parkIdea,
  recordOutOfScopeRequest,
  requestScopeOverride,
  requestShutdown,
  requestTimeOverride,
  startSession,
} from "./core/power-governor.js";

type ParsedArgs = {
  command: string | undefined;
  flags: Map<string, string[]>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string[]>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const flagName = token.slice(2);
    const next = rest[index + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (value !== "true") {
      index += 1;
    }

    const currentValues = flags.get(flagName) ?? [];
    currentValues.push(value);
    flags.set(flagName, currentValues);
  }

  return { command, flags };
}

function getRequiredFlag(flags: Map<string, string[]>, name: string): string {
  const value = flags.get(name)?.at(-1);

  if (!value) {
    throw new Error(`Missing required flag: --${name}`);
  }

  return value;
}

function getOptionalFlag(flags: Map<string, string[]>, name: string): string | undefined {
  return flags.get(name)?.at(-1);
}

function getFlagList(flags: Map<string, string[]>, name: string): string[] {
  return flags.get(name) ?? [];
}

function printState(state: unknown, asJson: boolean) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const workspace = process.env.POWER_WORKSPACE ?? process.cwd();
  const toolOrigin = process.env.POWER_TOOL_ORIGIN ?? "claude";
  const now = new Date();

  switch (command) {
    case "start": {
      const result = await startSession({
        workspace,
        toolOrigin,
        mission: getRequiredFlag(flags, "mission"),
        approvedTasks: getFlagList(flags, "task"),
        timeboxMinutes: getOptionalFlag(flags, "timebox")
          ? Number(getOptionalFlag(flags, "timebox"))
          : undefined,
        now,
      });
      printState(result, flags.has("json"));
      return;
    }

    case "check": {
      const state = await getSessionState({ workspace });
      if (!state) {
        throw new PowerGovernorError("No active session", "no_active_session");
      }

      printState(state, flags.has("json"));
      return;
    }

    case "park": {
      const result = await parkIdea({
        workspace,
        toolOrigin,
        now,
        idea: getRequiredFlag(flags, "idea"),
        reason: getRequiredFlag(flags, "reason"),
      });
      printState(result, flags.has("json"));
      return;
    }

    case "out-of-scope": {
      const result = await recordOutOfScopeRequest({
        workspace,
        toolOrigin,
        now,
        reason: getRequiredFlag(flags, "reason"),
      });
      printState(result, flags.has("json"));
      return;
    }

    case "scope-override": {
      const current = await getSessionState({ workspace });
      if (!current) {
        throw new PowerGovernorError("No active session", "no_active_session");
      }

      const result = await requestScopeOverride({
        workspace,
        toolOrigin,
        now,
        reason: getRequiredFlag(flags, "reason"),
        mission: getOptionalFlag(flags, "mission") ?? current.mission,
        approvedTasks: getFlagList(flags, "task"),
      });
      printState(result, flags.has("json"));
      return;
    }

    case "expire": {
      const result = await expireTimebox({
        workspace,
        toolOrigin,
        now,
        reason: getRequiredFlag(flags, "reason"),
      });
      printState(result, flags.has("json"));
      return;
    }

    case "time-override": {
      const result = await requestTimeOverride({
        workspace,
        toolOrigin,
        now,
        reason: getRequiredFlag(flags, "reason"),
      });
      printState(result, flags.has("json"));
      return;
    }

    case "shutdown": {
      const result = await requestShutdown({
        workspace,
        toolOrigin,
        now,
        completedItems: getFlagList(flags, "completed"),
        unfinishedApprovedItems: getFlagList(flags, "unfinished"),
        openQuestions: getFlagList(flags, "question"),
        parkingReferences: getFlagList(flags, "parking"),
      });
      process.stdout.write(result.output);
      return;
    }

    case "confirm-shutdown": {
      const result = await confirmShutdown({
        workspace,
        toolOrigin,
        now,
        reason: getRequiredFlag(flags, "reason"),
      });
      printState(result, flags.has("json"));
      return;
    }

    default:
      throw new Error(
        "Unknown command. Supported commands: start, check, park, out-of-scope, scope-override, expire, time-override, shutdown, confirm-shutdown",
      );
  }
}

main().catch((error: unknown) => {
  if (error instanceof PowerGovernorError) {
    process.stderr.write(`${error.refusalReason}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stderr.write("Unknown error\n");
  process.exitCode = 1;
});
