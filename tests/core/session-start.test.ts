import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { startSession } from "../../src/core/power-governor.js";

const tempDirs: string[] = [];

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "power-governor-"));
  tempDirs.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("startSession", () => {
  test("creates a Commit session with default timebox and an event log entry", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    const state = await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the CLI lifecycle",
      approvedTasks: ["Define state schema", "Implement session start"],
      now,
    });

    expect(state.mode).toBe("Commit");
    expect(state.timeboxMinutes).toBe(60);
    expect(state.mission).toBe("Ship the CLI lifecycle");
    expect(state.approvedTasks).toEqual(["Define state schema", "Implement session start"]);
    expect(state.sessionId).toMatch(/^session_/);
    expect(state.remainingExtensionCount).toBe(1);

    const sessionJson = JSON.parse(
      await readFile(join(workspace, ".power-governor", "session.json"), "utf8"),
    );
    expect(sessionJson.mode).toBe("Commit");

    const today = await readFile(join(workspace, ".power-governor", "today.md"), "utf8");
    expect(today).toContain("Ship the CLI lifecycle");
    expect(today).toContain("Define state schema");
    expect(today).toContain("Implement session start");

    const eventLines = (
      await readFile(join(workspace, ".power-governor", "events.jsonl"), "utf8")
    ).trim().split("\n");
    expect(eventLines).toHaveLength(1);
    expect(JSON.parse(eventLines[0])).toMatchObject({
      eventType: "session_start",
      fromMode: "Idle",
      toMode: "Commit",
      toolOrigin: "claude",
    });

    const lockFile = await stat(join(workspace, ".power-governor", "session.lock")).catch(() => null);
    expect(lockFile).toBeNull();
  });
});
