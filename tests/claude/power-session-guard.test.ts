import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hookPath = join(repoRoot, "adapters/claude/hooks/power-session-guard.sh");

async function createWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), "power-governor-hook-"));
  tempDirs.push(workspace);
  return workspace;
}

function runHook(input: object, env: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolveRun, reject) => {
    const child = spawn(hookPath, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolveRun({ stdout, stderr, exitCode });
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Claude power session guard hook", () => {
  test("returns no context when there is no active session", async () => {
    const workspace = await createWorkspace();
    const binDir = join(workspace, "bin");
    await mkdir(binDir, { recursive: true });

    const powerWrapper = join(binDir, "power");
    await writeFile(
      powerWrapper,
      `#!/usr/bin/env bash\ncd "${repoRoot}"\nexec node_modules/.bin/tsx src/cli.ts "$@"\n`,
      "utf8",
    );
    await execFileAsync("chmod", ["+x", powerWrapper]);

    const result = await runHook(
      {
        session_id: "abc123",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: workspace,
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
        prompt: "Help me write a new feature",
      },
      {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        CLAUDE_PROJECT_DIR: workspace,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  test("emits additionalContext with capped parking matches and policy guidance", async () => {
    const workspace = await createWorkspace();
    const binDir = join(workspace, "bin");
    await mkdir(binDir, { recursive: true });

    const powerWrapper = join(binDir, "power");
    await writeFile(
      powerWrapper,
      `#!/usr/bin/env bash\ncd "${repoRoot}"\nexec node_modules/.bin/tsx src/cli.ts "$@"\n`,
      "utf8",
    );
    await execFileAsync("chmod", ["+x", powerWrapper]);

    await execFileAsync(
      powerWrapper,
      [
        "start",
        "--mission",
        "Ship the Claude adapter",
        "--task",
        "Wire the hook",
        "--task",
        "Document the workflow",
      ],
      {
        env: {
          ...process.env,
          POWER_WORKSPACE: workspace,
          POWER_TOOL_ORIGIN: "claude",
          TZ: "UTC",
        },
      },
    );

    for (let index = 0; index < 6; index += 1) {
      await execFileAsync(
        powerWrapper,
        [
          "park",
          "--idea",
          `Parking hook context idea ${index}`,
          "--reason",
          `parking hook context reason ${index}`,
        ],
        {
          env: {
            ...process.env,
            POWER_WORKSPACE: workspace,
            POWER_TOOL_ORIGIN: "claude",
            TZ: "UTC",
          },
        },
      );
    }

    const result = await runHook(
      {
        session_id: "abc123",
        transcript_path: "/tmp/transcript.jsonl",
        cwd: workspace,
        permission_mode: "default",
        hook_event_name: "UserPromptSubmit",
        prompt: "Can we also add hook context review and parked idea compaction?",
      },
      {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        CLAUDE_PROJECT_DIR: workspace,
      },
    );

    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Power Governor Context");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Power Governor Policy");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/power-park");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/power-scope-override");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/power-review-parking");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/power-search-parking");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("more matches available");
  });
});
