import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  PowerGovernorError,
  recordOutOfScopeRequest,
  requestScopeOverride,
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

describe("scope overrides and guards", () => {
  test("refuses sessions with more than three approved tasks", async () => {
    const workspace = await createWorkspace();

    await expect(
      startSession({
        workspace,
        toolOrigin: "claude",
        mission: "Ship the CLI lifecycle",
        approvedTasks: ["one", "two", "three", "four"],
        now: new Date("2026-03-15T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      refusalReason: "task_cap_exceeded",
    });
  });

  test("rejects plain out-of-scope work while already in Converge", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    await recordOutOfScopeRequest({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:05:00.000Z"),
      reason: "Add a scheduling system",
    });

    await recordOutOfScopeRequest({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:10:00.000Z"),
      reason: "Add a weekly planning mode",
    });

    await expect(
      recordOutOfScopeRequest({
        workspace,
        toolOrigin: "claude",
        now: new Date("2026-03-15T12:15:00.000Z"),
        reason: "Sneak in another feature",
      }),
    ).rejects.toMatchObject({
      refusalReason: "out_of_scope_in_converge",
    });
  });

  test("allows an explicit scope override and rewrites scope intentionally", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    const overridden = await requestScopeOverride({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:20:00.000Z"),
      reason: "Swap one implementation task for a CLI parser task",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Add CLI parser"],
    });

    expect(overridden.mode).toBe("Converge");
    expect(overridden.overrideCount).toBe(1);
    expect(overridden.approvedTasks).toEqual(["Define state schema", "Add CLI parser"]);
    expect(overridden.lastTransitionReason).toBe("scope_override_requested");
  });
});
