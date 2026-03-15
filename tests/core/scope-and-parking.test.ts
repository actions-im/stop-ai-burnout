import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  getSessionState,
  parkIdea,
  recordOutOfScopeRequest,
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

describe("scope control", () => {
  test("moves a session into Converge on the second out-of-scope request", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now,
    });

    const first = await recordOutOfScopeRequest({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:05:00.000Z"),
      reason: "Add a scheduling system",
    });
    expect(first.mode).toBe("Commit");
    expect(first.driftCount).toBe(1);

    const second = await recordOutOfScopeRequest({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:10:00.000Z"),
      reason: "Add a weekly planning mode",
    });
    expect(second.mode).toBe("Converge");
    expect(second.driftCount).toBe(2);
    expect(second.lastTransitionReason).toBe("out_of_scope_request");

    const persisted = await getSessionState({ workspace });
    expect(persisted?.mode).toBe("Converge");
    expect(persisted?.driftCount).toBe(2);
  });

  test("parks ideas from any active mode without altering approved tasks", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now,
    });

    const parked = await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:06:00.000Z"),
      idea: "Support Cursor next",
      reason: "Future adapter work",
    });

    expect(parked.mode).toBe("Commit");
    expect(parked.approvedTasks).toEqual(["Define state schema", "Implement session start"]);
    expect(parked.parkingEntry.idea).toBe("Support Cursor next");
  });
});
