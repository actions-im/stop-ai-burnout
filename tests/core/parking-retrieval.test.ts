import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  PowerGovernorError,
  compactParkingEntries,
  getPromptContext,
  parkIdea,
  reviewParkingEntries,
  searchParkingEntries,
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

describe("parking retrieval", () => {
  test("searches parked ideas deterministically with overlap scoring", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the Claude adapter",
      approvedTasks: ["Wire the hook", "Document the workflow"],
      now,
    });

    await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:01:00.000Z"),
      idea: "Parking compaction for Claude ideas",
      reason: "parking compaction support",
    });

    await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:02:00.000Z"),
      idea: "Parking retrieval review flow",
      reason: "review parked ideas later",
    });

    await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:03:00.000Z"),
      idea: "Weekly planning calendar",
      reason: "defer scheduling work",
    });

    const matches = await searchParkingEntries({
      workspace,
      query: "PARKING!!! compaction",
    });

    expect(matches.map((match) => match.idea)).toEqual([
      "Parking compaction for Claude ideas",
      "Parking retrieval review flow",
    ]);
    expect(matches[0]).toMatchObject({
      ideaOverlap: 2,
      reasonOverlap: 2,
    });
    expect(matches[1]).toMatchObject({
      ideaOverlap: 1,
      reasonOverlap: 0,
    });
  });

  test("returns prompt context with capped matches and size budget", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the Claude adapter",
      approvedTasks: ["Wire the hook", "Document the workflow"],
      now,
    });

    for (let index = 0; index < 6; index += 1) {
      await parkIdea({
        workspace,
        toolOrigin: "claude",
        now: new Date(`2026-03-15T12:0${index}:00.000Z`),
        idea: `Parking match ${index} for hook context`,
        reason: `parking hook context ${"x".repeat(500)}`,
      });
    }

    const promptContext = await getPromptContext({
      workspace,
      prompt: "Need help with parking hook context",
    });

    expect(promptContext).not.toBeNull();
    expect(promptContext?.mode).toBe("Commit");
    expect(promptContext?.totalMatchCount).toBe(6);
    expect(promptContext?.hasMore).toBe(true);
    expect(promptContext?.parkingMatches.length).toBeLessThanOrEqual(5);
    expect(JSON.stringify(promptContext?.parkingMatches).length).toBeLessThanOrEqual(2048);
  });

  test("returns null prompt context when there is no active session", async () => {
    const workspace = await createWorkspace();

    const promptContext = await getPromptContext({
      workspace,
      prompt: "Need help with parking hook context",
    });

    expect(promptContext).toBeNull();
  });

  test("compacts multiple active parked entries into one canonical entry", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the Claude adapter",
      approvedTasks: ["Wire the hook", "Document the workflow"],
      now,
    });

    const first = await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:01:00.000Z"),
      idea: "Parking compaction for Claude ideas",
      reason: "parking compaction support",
    });
    const second = await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:02:00.000Z"),
      idea: "Compact duplicate parked idea matches",
      reason: "parking cleanup",
    });
    await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:03:00.000Z"),
      idea: "Weekly planning calendar",
      reason: "defer scheduling work",
    });

    const compacted = await compactParkingEntries({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:10:00.000Z"),
      entryIds: [first.parkingEntry.entryId, second.parkingEntry.entryId],
      idea: "Canonical parked idea for parking compaction",
      reason: "Merged duplicate parking compaction ideas",
    });

    expect(compacted.parkingEntry.idea).toBe("Canonical parked idea for parking compaction");

    const review = await reviewParkingEntries({ workspace });
    expect(review.map((entry) => entry.idea)).toEqual([
      "Canonical parked idea for parking compaction",
      "Weekly planning calendar",
    ]);

    const search = await searchParkingEntries({
      workspace,
      query: "parking compaction canonical",
    });
    expect(search.map((entry) => entry.idea)).toContain(
      "Canonical parked idea for parking compaction",
    );
    expect(search.map((entry) => entry.idea)).not.toContain(
      "Parking compaction for Claude ideas",
    );
  });

  test("requires at least two active parking entries to compact", async () => {
    const workspace = await createWorkspace();
    const now = new Date("2026-03-15T12:00:00.000Z");

    await startSession({
      workspace,
      toolOrigin: "claude",
      mission: "Ship the Claude adapter",
      approvedTasks: ["Wire the hook", "Document the workflow"],
      now,
    });

    const first = await parkIdea({
      workspace,
      toolOrigin: "claude",
      now: new Date("2026-03-15T12:01:00.000Z"),
      idea: "Parking compaction for Claude ideas",
      reason: "parking compaction support",
    });

    await expect(
      compactParkingEntries({
        workspace,
        toolOrigin: "claude",
        now: new Date("2026-03-15T12:10:00.000Z"),
        entryIds: [first.parkingEntry.entryId],
        idea: "Canonical parked idea for parking compaction",
        reason: "Merged duplicate parking compaction ideas",
      }),
    ).rejects.toMatchObject({
      refusalReason: "invalid_parking_compaction",
    } satisfies Partial<PowerGovernorError>);
  });
});
