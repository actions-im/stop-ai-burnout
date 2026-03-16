import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Mode = "Idle" | "Commit" | "Converge" | "Shutdown";

export type SessionState = {
  schemaVersion: number;
  sessionId: string;
  toolOrigin: string;
  mode: Mode;
  currentModeEnteredAt: string;
  mission: string;
  approvedTasks: string[];
  taskStatuses: Array<"pending" | "completed" | "dropped">;
  timeboxMinutes: number;
  startedAt: string;
  expiresAt: string;
  remainingExtensionCount: number;
  driftCount: number;
  overrideCount: number;
  overrideHistory: string[];
  lastTransitionReason: string;
  lastUpdatedAt: string;
};

type StartSessionInput = {
  workspace: string;
  toolOrigin: string;
  mission: string;
  approvedTasks: string[];
  now: Date;
  timeboxMinutes?: number;
};

type EventRecord = {
  eventId: string;
  sessionId: string;
  timestamp: string;
  eventType: string;
  fromMode: Mode;
  toMode: Mode;
  reason: string;
  toolOrigin: string;
};

export type ParkingEntry = {
  recordType: "parking_entry";
  entryId: string;
  sessionId: string;
  timestamp: string;
  idea: string;
  reason: string;
  toolOrigin: string;
};

export type ParkingCompaction = {
  recordType: "parking_compaction";
  entryId: string;
  sessionId: string;
  timestamp: string;
  idea: string;
  reason: string;
  toolOrigin: string;
  sourceEntryIds: string[];
};

export type ParkingRecord = ParkingEntry | ParkingCompaction;

export type ParkingMatch = ParkingRecord & {
  ideaOverlap: number;
  reasonOverlap: number;
};

export type PromptContext = {
  mode: Mode;
  mission: string;
  approvedTasks: string[];
  parkingMatches: ParkingMatch[];
  totalMatchCount: number;
  hasMore: boolean;
};

type LegacyParkingEntry = Omit<ParkingEntry, "recordType">;

export type RefusalReason =
  | "timebox_expired"
  | "time_override_before_expiry"
  | "task_cap_exceeded"
  | "second_post_expiry_override_denied"
  | "out_of_scope_in_converge"
  | "invalid_parking_compaction"
  | "no_active_session";

export class PowerGovernorError extends Error {
  refusalReason: RefusalReason;

  constructor(message: string, refusalReason: RefusalReason) {
    super(message);
    this.name = "PowerGovernorError";
    this.refusalReason = refusalReason;
  }
}

const STATE_DIR = ".power-governor";
const SESSION_FILE = "session.json";
const EVENTS_FILE = "events.jsonl";
const PARKING_FILE = "parking-lot.jsonl";
const SHUTDOWN_FILE = "shutdown.md";
const TODAY_FILE = "today.md";
const LOCK_FILE = "session.lock";
const STALE_LOCK_MS = 60_000;
const PROMPT_CONTEXT_MAX_MATCHES = 5;
const PROMPT_CONTEXT_MAX_BYTES = 2_048;

function buildSessionId(now: Date) {
  return `session_${now.toISOString().replaceAll(/[:.-]/g, "")}`;
}

function buildEventId(sessionId: string, suffix: string) {
  return `${sessionId}_${suffix}`;
}

async function ensureStateDir(workspace: string) {
  const stateDir = join(workspace, STATE_DIR);
  await mkdir(stateDir, { recursive: true });
  await writeIfMissing(join(stateDir, EVENTS_FILE), "");
  await writeIfMissing(join(stateDir, PARKING_FILE), "");
  return stateDir;
}

async function writeIfMissing(path: string, contents: string) {
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, contents, "utf8");
  }
}

async function appendEvent(workspace: string, eventRecord: EventRecord) {
  await appendFile(
    join(workspace, STATE_DIR, EVENTS_FILE),
    `${JSON.stringify(eventRecord)}\n`,
    "utf8",
  );
}

async function appendParkingEntry(workspace: string, entry: ParkingRecord) {
  await appendFile(
    join(workspace, STATE_DIR, PARKING_FILE),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}

async function readParkingRecords(workspace: string): Promise<ParkingRecord[]> {
  try {
    const raw = await readFile(join(workspace, STATE_DIR, PARKING_FILE), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ParkingRecord | LegacyParkingEntry)
      .map((record) =>
        "recordType" in record ? record : { ...record, recordType: "parking_entry" as const },
      );
  } catch {
    return [];
  }
}

function sortParkingEntriesNewestFirst<T extends { timestamp: string }>(entries: T[]) {
  return [...entries].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

async function getActiveParkingEntries(workspace: string): Promise<ParkingRecord[]> {
  const records = await readParkingRecords(workspace);
  const activeEntries = new Map<string, ParkingRecord>();
  const supersededIds = new Set<string>();

  for (const record of records) {
    if (record.recordType === "parking_entry") {
      if (!supersededIds.has(record.entryId)) {
        activeEntries.set(record.entryId, record);
      }
      continue;
    }

    for (const sourceEntryId of record.sourceEntryIds) {
      supersededIds.add(sourceEntryId);
      activeEntries.delete(sourceEntryId);
    }

    activeEntries.set(record.entryId, record);
  }

  return sortParkingEntriesNewestFirst([...activeEntries.values()]);
}

function tokenizeSearchText(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function overlapCount(queryTokens: string[], candidateText: string) {
  if (queryTokens.length === 0) {
    return 0;
  }

  const candidateTokens = new Set(tokenizeSearchText(candidateText));
  const uniqueQueryTokens = new Set(queryTokens);
  let overlap = 0;

  for (const token of uniqueQueryTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function sortParkingMatches(matches: ParkingMatch[]) {
  return [...matches].sort((left, right) => {
    if (right.ideaOverlap !== left.ideaOverlap) {
      return right.ideaOverlap - left.ideaOverlap;
    }

    if (right.reasonOverlap !== left.reasonOverlap) {
      return right.reasonOverlap - left.reasonOverlap;
    }

    return right.timestamp.localeCompare(left.timestamp);
  });
}

function shrinkPromptMatches(matches: ParkingMatch[]) {
  const preview: ParkingMatch[] = [];

  for (const match of matches.slice(0, PROMPT_CONTEXT_MAX_MATCHES)) {
    const candidatePreview = [...preview, match];
    if (JSON.stringify(candidatePreview).length <= PROMPT_CONTEXT_MAX_BYTES) {
      preview.push(match);
      continue;
    }

    if (preview.length === 0) {
      preview.push({
        ...match,
        idea: match.idea.slice(0, 256),
        reason: match.reason.slice(0, 256),
      });
    }

    break;
  }

  return preview;
}

async function saveSessionState(workspace: string, sessionState: SessionState) {
  await writeFile(
    join(workspace, STATE_DIR, SESSION_FILE),
    JSON.stringify(sessionState, null, 2),
    "utf8",
  );
}

function renderTodaySummary(sessionState: SessionState) {
  return [
    "# Today",
    "",
    `Mission: ${sessionState.mission}`,
    `Mode: ${sessionState.mode}`,
    `Timebox: ${sessionState.timeboxMinutes} minutes`,
    "",
    "## Approved Tasks",
    ...sessionState.approvedTasks.map((task, index) => {
      const status = sessionState.taskStatuses[index] ?? "pending";
      const marker = status === "completed" ? "x" : status === "dropped" ? "-" : " ";
      return `- [${marker}] ${task}`;
    }),
    "",
  ].join("\n");
}

async function updateTodaySummary(workspace: string, sessionState: SessionState) {
  await writeFile(
    join(workspace, STATE_DIR, TODAY_FILE),
    renderTodaySummary(sessionState),
    "utf8",
  );
}

function nextEvent(
  session: SessionState,
  now: Date,
  eventType: string,
  toolOrigin: string,
  fromMode: Mode,
  toMode: Mode,
  reason: string,
): EventRecord {
  return {
    eventId: buildEventId(session.sessionId, `${eventType}_${now.getTime()}`),
    sessionId: session.sessionId,
    timestamp: now.toISOString(),
    eventType,
    fromMode,
    toMode,
    reason,
    toolOrigin,
  };
}

export async function getSessionState(input: { workspace: string }): Promise<SessionState | null> {
  try {
    const raw = await readFile(join(input.workspace, STATE_DIR, SESSION_FILE), "utf8");
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

export async function reviewParkingEntries(input: { workspace: string }): Promise<ParkingRecord[]> {
  return getActiveParkingEntries(input.workspace);
}

export async function searchParkingEntries(input: {
  workspace: string;
  query: string;
}): Promise<ParkingMatch[]> {
  const queryTokens = tokenizeSearchText(input.query);

  if (queryTokens.length === 0) {
    return [];
  }

  const activeEntries = await getActiveParkingEntries(input.workspace);
  const matches = activeEntries
    .map((entry) => {
      const ideaOverlap = overlapCount(queryTokens, entry.idea);
      const reasonOverlap = overlapCount(queryTokens, entry.reason);
      return {
        ...entry,
        ideaOverlap,
        reasonOverlap,
      };
    })
    .filter((entry) => entry.ideaOverlap + entry.reasonOverlap > 0);

  return sortParkingMatches(matches);
}

export async function getPromptContext(input: {
  workspace: string;
  prompt: string;
}): Promise<PromptContext | null> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    return null;
  }

  const matches = await searchParkingEntries({
    workspace: input.workspace,
    query: input.prompt,
  });
  const parkingMatches = shrinkPromptMatches(matches);

  return {
    mode: session.mode,
    mission: session.mission,
    approvedTasks: session.approvedTasks,
    parkingMatches,
    totalMatchCount: matches.length,
    hasMore: parkingMatches.length < matches.length,
  };
}

export async function startSession(input: StartSessionInput): Promise<SessionState> {
  await ensureStateDir(input.workspace);

  if (input.approvedTasks.length < 1 || input.approvedTasks.length > 3) {
    throw new PowerGovernorError(
      "Approved task count must stay between 1 and 3",
      "task_cap_exceeded",
    );
  }

  const sessionId = buildSessionId(input.now);
  const timeboxMinutes = input.timeboxMinutes ?? 60;
  const expiresAt = new Date(input.now.getTime() + timeboxMinutes * 60_000).toISOString();
  const sessionState: SessionState = {
    schemaVersion: 1,
    sessionId,
    toolOrigin: input.toolOrigin,
    mode: "Commit",
    currentModeEnteredAt: input.now.toISOString(),
    mission: input.mission,
    approvedTasks: input.approvedTasks,
    taskStatuses: input.approvedTasks.map(() => "pending"),
    timeboxMinutes,
    startedAt: input.now.toISOString(),
    expiresAt,
    remainingExtensionCount: 1,
    driftCount: 0,
    overrideCount: 0,
    overrideHistory: [],
    lastTransitionReason: "session_start",
    lastUpdatedAt: input.now.toISOString(),
  };

  await saveSessionState(input.workspace, sessionState);
  await updateTodaySummary(input.workspace, sessionState);

  const eventRecord: EventRecord = {
    eventId: buildEventId(sessionId, "session_start"),
    sessionId,
    timestamp: input.now.toISOString(),
    eventType: "session_start",
    fromMode: "Idle",
    toMode: "Commit",
    reason: "User started a governed session",
    toolOrigin: input.toolOrigin,
  };

  await appendEvent(input.workspace, eventRecord);

  return sessionState;
}

export async function recordOutOfScopeRequest(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  reason: string;
}): Promise<SessionState> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  if (session.mode === "Converge") {
    throw new PowerGovernorError(
      "Out-of-scope work is not allowed while converging",
      "out_of_scope_in_converge",
    );
  }

  const previousMode = session.mode;
  session.driftCount += 1;
  session.mode = session.driftCount >= 2 ? "Converge" : session.mode;
  session.currentModeEnteredAt = input.now.toISOString();
  session.lastTransitionReason = "out_of_scope_request";
  session.lastUpdatedAt = input.now.toISOString();

  await saveSessionState(input.workspace, session);
  await updateTodaySummary(input.workspace, session);
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "out_of_scope_request",
      input.toolOrigin,
      previousMode,
      session.mode,
      input.reason,
    ),
  );

  return session;
}

export async function requestScopeOverride(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  reason: string;
  mission: string;
  approvedTasks: string[];
}): Promise<SessionState> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  if (input.approvedTasks.length < 1 || input.approvedTasks.length > 3) {
    throw new PowerGovernorError(
      "Approved task count must stay between 1 and 3",
      "task_cap_exceeded",
    );
  }

  const previousMode = session.mode;
  session.mode = "Converge";
  session.currentModeEnteredAt = input.now.toISOString();
  session.mission = input.mission;
  session.approvedTasks = input.approvedTasks;
  session.taskStatuses = input.approvedTasks.map(() => "pending");
  session.overrideCount += 1;
  session.overrideHistory.push(`scope_override:${input.reason}`);
  session.lastTransitionReason = "scope_override_requested";
  session.lastUpdatedAt = input.now.toISOString();

  await saveSessionState(input.workspace, session);
  await updateTodaySummary(input.workspace, session);
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "scope_override_requested",
      input.toolOrigin,
      previousMode,
      "Converge",
      input.reason,
    ),
  );

  return session;
}

export async function parkIdea(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  idea: string;
  reason: string;
}): Promise<SessionState & { parkingEntry: ParkingEntry }> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  const parkingEntry: ParkingEntry = {
    recordType: "parking_entry",
    entryId: buildEventId(session.sessionId, `park_${input.now.getTime()}`),
    sessionId: session.sessionId,
    timestamp: input.now.toISOString(),
    idea: input.idea,
    reason: input.reason,
    toolOrigin: input.toolOrigin,
  };

  session.lastUpdatedAt = input.now.toISOString();

  await saveSessionState(input.workspace, session);
  await updateTodaySummary(input.workspace, session);
  await appendParkingEntry(input.workspace, parkingEntry);
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "park_requested",
      input.toolOrigin,
      session.mode,
      session.mode,
      input.reason,
    ),
  );

  return {
    ...session,
    parkingEntry,
  };
}

export async function compactParkingEntries(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  entryIds: string[];
  idea: string;
  reason: string;
}): Promise<{ parkingEntry: ParkingCompaction }> {
  await ensureStateDir(input.workspace);

  const uniqueEntryIds = [...new Set(input.entryIds)];
  if (uniqueEntryIds.length < 2) {
    throw new PowerGovernorError(
      "Parking compaction requires at least two active parking entries",
      "invalid_parking_compaction",
    );
  }

  const activeEntries = await getActiveParkingEntries(input.workspace);
  const activeEntryIds = new Set(activeEntries.map((entry) => entry.entryId));

  for (const entryId of uniqueEntryIds) {
    if (!activeEntryIds.has(entryId)) {
      throw new PowerGovernorError(
        "Parking compaction can only use active parking entries",
        "invalid_parking_compaction",
      );
    }
  }

  const session = await getSessionState({ workspace: input.workspace });
  const sessionId = session?.sessionId ?? buildSessionId(input.now);
  const parkingEntry: ParkingCompaction = {
    recordType: "parking_compaction",
    entryId: buildEventId(sessionId, `parking_compaction_${input.now.getTime()}`),
    sessionId,
    timestamp: input.now.toISOString(),
    idea: input.idea,
    reason: input.reason,
    toolOrigin: input.toolOrigin,
    sourceEntryIds: uniqueEntryIds,
  };

  await appendParkingEntry(input.workspace, parkingEntry);

  return { parkingEntry };
}

export async function expireTimebox(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  reason: string;
}): Promise<SessionState> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  const previousMode = session.mode;
  session.mode = "Shutdown";
  session.currentModeEnteredAt = input.now.toISOString();
  session.lastTransitionReason = "timebox_expired";
  session.lastUpdatedAt = input.now.toISOString();
  session.expiresAt = input.now.toISOString();

  await saveSessionState(input.workspace, session);
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "timebox_expired",
      input.toolOrigin,
      previousMode,
      "Shutdown",
      input.reason,
    ),
  );

  return session;
}

export async function requestTimeOverride(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  reason: string;
}): Promise<SessionState> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  if (session.mode !== "Shutdown" || input.now.getTime() < new Date(session.expiresAt).getTime()) {
    throw new PowerGovernorError(
      "Time override is only allowed after the active session has expired",
      "time_override_before_expiry",
    );
  }

  if (session.remainingExtensionCount <= 0) {
    throw new PowerGovernorError(
      "A second post-expiry override is not allowed",
      "second_post_expiry_override_denied",
    );
  }

  const previousMode = session.mode;
  session.mode = "Converge";
  session.currentModeEnteredAt = input.now.toISOString();
  session.overrideCount += 1;
  session.overrideHistory.push(`time_override:${input.reason}`);
  session.remainingExtensionCount -= 1;
  session.lastTransitionReason = "time_override_requested";
  session.lastUpdatedAt = input.now.toISOString();
  session.expiresAt = new Date(input.now.getTime() + 15 * 60_000).toISOString();

  await saveSessionState(input.workspace, session);
  await updateTodaySummary(input.workspace, session);
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "time_override_requested",
      input.toolOrigin,
      previousMode,
      "Converge",
      input.reason,
    ),
  );

  return session;
}

function renderList(items: string[]) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderShutdownOutput(input: {
  mission: string;
  completedItems: string[];
  unfinishedApprovedItems: string[];
  openQuestions: string[];
  parkingReferences: string[];
}) {
  return [
    `# Shutdown Summary`,
    ``,
    `Mission: ${input.mission}`,
    ``,
    `## Completed Approved Items`,
    renderList(input.completedItems),
    ``,
    `## Unfinished Approved Items`,
    renderList(input.unfinishedApprovedItems),
    ``,
    `## Open Factual Questions`,
    renderList(input.openQuestions),
    ``,
    `## Parking References`,
    renderList(input.parkingReferences),
    ``,
    `## Stop Confirmation`,
    `Stop here. The session is closed.`,
    ``,
  ].join("\n");
}

export async function requestShutdown(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  completedItems: string[];
  unfinishedApprovedItems: string[];
  openQuestions: string[];
  parkingReferences: string[];
}): Promise<{ state: SessionState; output: string }> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  const previousMode = session.mode;
  session.mode = "Shutdown";
  session.currentModeEnteredAt = input.now.toISOString();
  session.lastTransitionReason = "shutdown_requested";
  session.lastUpdatedAt = input.now.toISOString();

  const output = renderShutdownOutput({
    mission: session.mission,
    completedItems: input.completedItems,
    unfinishedApprovedItems: input.unfinishedApprovedItems,
    openQuestions: input.openQuestions,
    parkingReferences: input.parkingReferences,
  });

  await saveSessionState(input.workspace, session);
  await updateTodaySummary(input.workspace, session);
  await writeFile(join(input.workspace, STATE_DIR, SHUTDOWN_FILE), output, "utf8");
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "shutdown_requested",
      input.toolOrigin,
      previousMode,
      "Shutdown",
      "User requested shutdown",
    ),
  );

  return { state: session, output };
}

export async function confirmShutdown(input: {
  workspace: string;
  toolOrigin: string;
  now: Date;
  reason: string;
}): Promise<SessionState> {
  const session = await getSessionState({ workspace: input.workspace });

  if (!session) {
    throw new PowerGovernorError("No active session", "no_active_session");
  }

  const previousMode = session.mode;
  session.mode = "Idle";
  session.currentModeEnteredAt = input.now.toISOString();
  session.lastTransitionReason = "shutdown_confirmed";
  session.lastUpdatedAt = input.now.toISOString();

  await saveSessionState(input.workspace, session);
  await updateTodaySummary(input.workspace, session);
  await appendEvent(
    input.workspace,
    nextEvent(
      session,
      input.now,
      "shutdown_confirmed",
      input.toolOrigin,
      previousMode,
      "Idle",
      input.reason,
    ),
  );

  return session;
}

export async function repairWorkspace(input: {
  workspace: string;
  now: Date;
}): Promise<{ clearedStaleLock: boolean }> {
  const lockPath = join(input.workspace, STATE_DIR, LOCK_FILE);
  const lockStats = await stat(lockPath).catch(() => null);

  if (!lockStats) {
    return { clearedStaleLock: false };
  }

  if (input.now.getTime() - lockStats.mtime.getTime() > STALE_LOCK_MS) {
    await rm(lockPath, { force: true });
    return { clearedStaleLock: true };
  }

  return { clearedStaleLock: false };
}
