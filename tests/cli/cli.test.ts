import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "power-governor-cli-"));
  tempDirs.push(workspace);
  return workspace;
}

async function runCli(workspace: string, args: string[]) {
  return execFileAsync("node_modules/.bin/tsx", ["src/cli.ts", ...args], {
    cwd: "/Users/sergeyzelvenskiy/stop-ai-burnout",
    env: {
      ...process.env,
      POWER_WORKSPACE: workspace,
      POWER_TOOL_ORIGIN: "claude",
      TZ: "UTC",
    },
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI", () => {
  test("runs the core loop end to end", async () => {
    const workspace = await createWorkspace();

    await runCli(workspace, [
      "start",
      "--mission",
      "Ship the CLI lifecycle",
      "--task",
      "Define state schema",
      "--task",
      "Implement session start",
    ]);

    const status = await runCli(workspace, ["check", "--json"]);
    const parsedStatus = JSON.parse(status.stdout);
    expect(parsedStatus.mode).toBe("Commit");
    expect(parsedStatus.approvedTasks).toEqual([
      "Define state schema",
      "Implement session start",
    ]);

    await runCli(workspace, ["park", "--idea", "Support Codex adapter", "--reason", "Later"]);
    await runCli(workspace, ["out-of-scope", "--reason", "Add a scheduling layer"]);
    const converge = await runCli(workspace, ["out-of-scope", "--reason", "Add weekly planning"]);
    expect(converge.stdout).toContain("Converge");

    await runCli(workspace, ["scope-override", "--reason", "Swap current task", "--task", "Define state schema", "--task", "Add CLI parser"]);
    await runCli(workspace, ["expire", "--reason", "Timebox expired"]);
    await runCli(workspace, ["time-override", "--reason", "Finish current task"]);

    const shutdown = await runCli(workspace, [
      "shutdown",
      "--completed",
      "Defined the state schema",
      "--unfinished",
      "Add CLI parser",
      "--question",
      "Should the lock timeout be configurable?",
      "--parking",
      "Support Codex adapter",
    ]);
    expect(shutdown.stdout).toContain("Shutdown Summary");

    const confirmed = await runCli(workspace, ["confirm-shutdown", "--reason", "Closed cleanly"]);
    expect(confirmed.stdout).toContain("Idle");
  });
});
