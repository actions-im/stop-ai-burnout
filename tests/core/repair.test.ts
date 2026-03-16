import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { repairWorkspace, startSession } from "../../src/core/power-governor.js";

const tempDirs: string[] = [];

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "power-governor-"));
  tempDirs.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("repairWorkspace", () => {
  test("clears a stale session lock older than 60 seconds", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    const lockPath = join(workspace, ".power-governor", "session.lock");
    await writeFile(lockPath, "stale", "utf8");
    await utimes(lockPath, new Date("2026-03-15T11:58:30.000Z"), new Date("2026-03-15T11:58:30.000Z"));

    const repaired = await repairWorkspace({
      workspace,
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    expect(repaired.clearedStaleLock).toBe(true);
  });
});
