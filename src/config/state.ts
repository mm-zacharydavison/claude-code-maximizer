import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { STATE_PATH } from "../utils/paths.ts";
import { now } from "../utils/time.ts";
import { logError, isValidTimestamp, isValidNumber } from "../utils/errors.ts";

export interface State {
  installed_at: string | null;
  learning_complete: boolean;
  current_window_start: string | null;
  current_window_end: string | null; // From Claude's actual reset time
  daemon_pid: number | null;
}

const DEFAULT_STATE: State = {
  installed_at: null,
  learning_complete: false,
  current_window_start: null,
  current_window_end: null,
  daemon_pid: null,
};

/**
 * Validates and sanitizes state values
 */
function sanitizeState(parsed: Partial<State>): Partial<State> {
  const sanitized: Partial<State> = {};

  // Validate installed_at
  if (parsed.installed_at === null || isValidTimestamp(parsed.installed_at)) {
    sanitized.installed_at = parsed.installed_at;
  }

  // Validate learning_complete
  if (typeof parsed.learning_complete === "boolean") {
    sanitized.learning_complete = parsed.learning_complete;
  }

  // Validate current_window_start
  if (parsed.current_window_start === null || isValidTimestamp(parsed.current_window_start)) {
    sanitized.current_window_start = parsed.current_window_start;
  }

  // Validate current_window_end
  if (parsed.current_window_end === null || isValidTimestamp(parsed.current_window_end)) {
    sanitized.current_window_end = parsed.current_window_end;
  }

  // Validate daemon_pid
  if (parsed.daemon_pid === null || (isValidNumber(parsed.daemon_pid) && parsed.daemon_pid > 0)) {
    sanitized.daemon_pid = parsed.daemon_pid;
  }

  return sanitized;
}

export function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const content = readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(content) as Partial<State>;
    const sanitized = sanitizeState(parsed);
    return { ...DEFAULT_STATE, ...sanitized };
  } catch (error) {
    logError("state:load", error);
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: State): void {
  const dir = dirname(STATE_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

export function updateState(updates: Partial<State>): State {
  const current = loadState();
  const updated = { ...current, ...updates };
  saveState(updated);
  return updated;
}

export function stateExists(): boolean {
  return existsSync(STATE_PATH);
}

export function markInstalled(): void {
  updateState({ installed_at: now() });
}

export function markLearningComplete(): void {
  updateState({ learning_complete: true });
}

export function setCurrentWindowStart(windowStart: string | null): void {
  updateState({ current_window_start: windowStart });
}

export function setCurrentWindowEnd(windowEnd: string | null): void {
  updateState({ current_window_end: windowEnd });
}

export function setDaemonPid(pid: number | null): void {
  updateState({ daemon_pid: pid });
}

export function isInstalled(): boolean {
  const state = loadState();
  return state.installed_at !== null;
}

export function isLearningComplete(): boolean {
  const state = loadState();
  return state.learning_complete;
}

export function getDaysSinceInstall(): number {
  const state = loadState();
  if (!state.installed_at) {
    return 0;
  }

  const installedAt = new Date(state.installed_at);
  const nowDate = new Date();
  const diffMs = nowDate.getTime() - installedAt.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}
