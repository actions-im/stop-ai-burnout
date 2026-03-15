import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  confirmShutdown,
  requestShutdown,
  startSession,
} from "../../src/core/power-governor.js";

const tempDirs: string[] = [];

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "power-governor-"));
  tempDirs.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("shutdown", () => {
  test("writes a constrained shutdown summary with no ideation language", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    const result = await requestShutdown({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:50:00.000Z"),
      completedItems: ["Defined the state schema"],
      unfinishedApprovedItems: ["Implement session start"],
      openQuestions: ["Should the lock timeout be configurable?"],
      parkingReferences: ["Support Codex adapter later"],
    });

    expect(result.state.mode).toBe("Shutdown");
    expect(result.output).toContain("## Completed Approved Items");
    expect(result.output).toContain("## Unfinished Approved Items");
    expect(result.output).toContain("## Open Factual Questions");
    expect(result.output).toContain("## Parking References");
    expect(result.output).toContain("## Stop Confirmation");
    expect(result.output.toLowerCase()).not.toContain("next i should");
    expect(result.output.toLowerCase()).not.toContain("new feature");
    expect(result.output.toLowerCase()).not.toContain("roadmap");
    expect(result.output.toLowerCase()).not.toContain("optimization");

    const persisted = await readFile(join(workspace, ".power-governor", "shutdown.md"), "utf8");
    expect(persisted).toBe(result.output);
  });

  test("confirms shutdown and returns the session to Idle", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    await requestShutdown({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:50:00.000Z"),
      completedItems: ["Defined the state schema"],
      unfinishedApprovedItems: ["Implement session start"],
      openQuestions: ["Should the lock timeout be configurable?"],
      parkingReferences: ["Support Codex adapter later"],
    });

    const confirmed = await confirmShutdown({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:51:00.000Z"),
      reason: "Session closed cleanly",
    });

    expect(confirmed.mode).toBe("Idle");
    expect(confirmed.lastTransitionReason).toBe("shutdown_confirmed");
  });
});
