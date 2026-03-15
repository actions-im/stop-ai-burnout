import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  PowerGovernorError,
  expireTimebox,
  requestTimeOverride,
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

describe("timebox enforcement", () => {
  test("forces Shutdown on expiry and allows exactly one 15-minute time override", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    const expired = await expireTimebox({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T13:00:00.000Z"),
      reason: "Session timer reached zero",
    });

    expect(expired.mode).toBe("Shutdown");
    expect(expired.lastTransitionReason).toBe("timebox_expired");
    expect(expired.remainingExtensionCount).toBe(1);

    const extended = await requestTimeOverride({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T13:01:00.000Z"),
      reason: "Need 15 minutes to finish current task",
    });

    expect(extended.mode).toBe("Converge");
    expect(extended.remainingExtensionCount).toBe(0);
    expect(extended.overrideCount).toBe(1);
    expect(extended.lastTransitionReason).toBe("time_override_requested");
  });

  test("refuses a second post-expiry time override with a stable refusal reason", async () => {
    const workspace = await createWorkspace();

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now: new Date("2026-03-15T12:00:00.000Z"),
    });

    await expireTimebox({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T13:00:00.000Z"),
      reason: "Session timer reached zero",
    });

    await requestTimeOverride({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T13:01:00.000Z"),
      reason: "Need 15 minutes to finish current task",
    });

    await expireTimebox({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T13:16:00.000Z"),
      reason: "Extension window ended",
    });

    await expect(
      requestTimeOverride({
        workspace,
        toolOrigin: "claude",
        now: new Date("2026-03-15T13:17:00.000Z"),
        reason: "Trying to push again",
      }),
    ).rejects.toMatchObject({
      refusalReason: "second_post_expiry_override_denied",
    });
  });
});
