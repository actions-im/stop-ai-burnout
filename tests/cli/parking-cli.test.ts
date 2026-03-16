import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "power-governor-cli-"));
  tempDirs.push(workspace);
  return workspace;
}

async function runCli(workspace: string, args: string[]) {
  return execFileAsync("node_modules/.bin/tsx", ["src/cli.ts", ...args], {
    cwd: repoRoot,
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

describe("parking CLI", () => {
  test("supports prompt context, review, search, and compaction", async () => {
    const workspace = await createWorkspace();

    await runCli(workspace, [
      "start",
      "--mission",
      "Ship the Claude adapter",
      "--task",
      "Wire the hook",
      "--task",
      "Document the workflow",
    ]);

    const first = JSON.parse(
      (
        await runCli(workspace, [
          "park",
          "--idea",
          "Parking compaction for Claude ideas",
          "--reason",
          "parking compaction support",
          "--json",
        ])
      ).stdout,
    );
    const second = JSON.parse(
      (
        await runCli(workspace, [
          "park",
          "--idea",
          "Compact duplicate parked idea matches",
          "--reason",
          "parking cleanup",
          "--json",
        ])
      ).stdout,
    );

    const review = JSON.parse((await runCli(workspace, ["parking-review", "--json"])).stdout);
    expect(review).toHaveLength(2);

    const search = JSON.parse(
      (
        await runCli(workspace, [
          "parking-search",
          "--query",
          "parking compaction",
          "--json",
        ])
      ).stdout,
    );
    expect(search).toHaveLength(2);

    const promptContext = JSON.parse(
      (
        await runCli(workspace, [
          "prompt-context",
          "--prompt",
          "Can we do parking compaction now?",
          "--json",
        ])
      ).stdout,
    );
    expect(promptContext.totalMatchCount).toBe(2);

    const compacted = JSON.parse(
      (
        await runCli(workspace, [
          "parking-compact",
          "--entry",
          first.parkingEntry.entryId,
          "--entry",
          second.parkingEntry.entryId,
          "--idea",
          "Canonical parked idea for parking compaction",
          "--reason",
          "Merged duplicate parking compaction ideas",
          "--json",
        ])
      ).stdout,
    );
    expect(compacted.parkingEntry.idea).toBe("Canonical parked idea for parking compaction");

    const reviewAfterCompaction = JSON.parse(
      (await runCli(workspace, ["parking-review", "--json"])).stdout,
    );
    expect(reviewAfterCompaction).toHaveLength(1);
    expect(reviewAfterCompaction[0].idea).toBe("Canonical parked idea for parking compaction");
  });
});
