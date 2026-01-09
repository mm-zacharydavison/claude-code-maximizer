import { loadConfig, type DayOfWeek } from "../config/index.ts";
import {
  loadState,
  getLastAutoStartTime,
  setLastAutoStartTime as persistLastAutoStartTime,
} from "../config/state.ts";
import { getCurrentWindow } from "../db/queries.ts";
import { getDayOfWeek, fromISO, diffMinutes, calculateOptimalStartTimes } from "../utils/time.ts";
import { notifyWindowEnding } from "./notifier.ts";
import { spawnClaudeSession } from "./autostart.ts";
import { safeExecute, safeExecuteAsync, logError } from "../utils/errors.ts";
import { getClaudeUsage, getCachedUsage } from "../usage/index.ts";

export interface SchedulerState {
  lastWindowEndWarning: Date | null;
}

const state: SchedulerState = {
  lastWindowEndWarning: null,
};

export const AUTOSTART_COOLDOWN_MINUTES = 60;
const WINDOW_WARNING_MINUTES = [30, 15, 5];
export const WINDOW_DURATION_MINUTES = 300; // 5 hours

/** Reset scheduler state (for testing) */
export function resetSchedulerState(): void {
  state.lastWindowEndWarning = null;
  // Also reset persisted autostart time
  persistLastAutoStartTime(null);
}

/** Set last auto-start time (for testing) - persists to disk */
export function setLastAutoStartTime(time: Date | null): void {
  persistLastAutoStartTime(time?.toISOString() ?? null);
}

/**
 * Main scheduler tick - runs every minute.
 * Handles auto-starting windows at optimal times and warning when windows are ending.
 */
export function runSchedulerTick(): void {
  try {
    const config = loadConfig();
    const appState = loadState();

    if (!config.notifications_enabled) {
      return;
    }

    const now = new Date();
    const dayOfWeek = getDayOfWeek(now) as DayOfWeek;

    // Calculate all optimal start times for today
    const optimalTimes = getOptimalTimesForDay(config, dayOfWeek);

    // Auto-start window if we're in a scheduled window period (and no window is currently active)
    // Note: optimal times are often BEFORE working hours to maximize coverage during work
    if (optimalTimes.length > 0 && !isWindowCurrentlyActive(appState, now)) {
      // Fire and forget - don't block the scheduler tick
      safeExecuteAsync("scheduler:autoStartWindowIfInPeriod", () =>
        autoStartWindowIfInPeriod(now, optimalTimes)
      );
    }

    // Warn if window is ending soon
    safeExecute("scheduler:warnIfWindowEnding", () => {
      const currentWindow = getCurrentWindow();
      if (currentWindow) {
        warnIfWindowEnding(now, currentWindow.window_end);
      }
    });
  } catch (error) {
    logError("scheduler:runSchedulerTick", error);
  }
}

/**
 * Check if there's a window currently active based on state timestamps.
 * A window is active if current_window_end exists and is in the future.
 * This is a quick local check - the actual Claude API check happens in autoStartWindowIfInPeriod.
 */
function isWindowCurrentlyActive(appState: ReturnType<typeof loadState>, now: Date): boolean {
  if (!appState.current_window_end) {
    return false;
  }
  const windowEnd = fromISO(appState.current_window_end);
  return windowEnd > now;
}

/**
 * Get all optimal start times for a given day.
 * Uses working hours config if enabled, otherwise falls back to legacy optimal_start_times.
 */
function getOptimalTimesForDay(config: ReturnType<typeof loadConfig>, dayOfWeek: DayOfWeek): string[] {
  const workingHours = config.working_hours;
  const dayHours = workingHours.enabled ? workingHours.hours[dayOfWeek] : null;

  if (dayHours) {
    // Calculate optimal start times from working hours
    return calculateOptimalStartTimes(dayHours.start, dayHours.end);
  }

  // Fallback to legacy single optimal_start_time
  const legacyTime = config.optimal_start_times[dayOfWeek];
  return legacyTime ? [legacyTime] : [];
}

/**
 * Auto-start a window if we're within a scheduled window period.
 * Triggers if current time is between optimal start time and window end (5 hours later).
 * This handles both on-time triggers and late triggers (e.g., machine was off at optimal time).
 */
export async function autoStartWindowIfInPeriod(now: Date, optimalTimes: string[]): Promise<void> {
  for (const optimalTime of optimalTimes) {
    const [hours, minutes] = optimalTime.split(":").map(Number);
    if (hours === undefined || minutes === undefined) continue;

    const windowStart = new Date(now);
    windowStart.setHours(hours, minutes, 0, 0);

    const windowEnd = new Date(windowStart.getTime() + WINDOW_DURATION_MINUTES * 60 * 1000);

    // Check cheap conditions first
    if (!(now >= windowStart && now < windowEnd && isAutoStartAllowed(now))) {
      continue;
    }

    // Check if window already active (expensive - fetches fresh usage from Claude)
    if (await isWindowAlreadyActive()) {
      console.log(`[${now.toISOString()}] Skipping auto-start: window already active`);
      return;
    }

    const minutesPastStart = Math.round((now.getTime() - windowStart.getTime()) / (60 * 1000));
    const lateMsg = minutesPastStart > 5 ? ` (${minutesPastStart} min late)` : "";
    console.log(`[${now.toISOString()}] Auto-starting Claude session for window ${optimalTime}${lateMsg}`);

    // Persist the autostart time before spawning (survives daemon restart)
    persistLastAutoStartTime(now.toISOString());

    spawnClaudeSession()
      .then((result) => {
        if (result.success) {
          console.log(`[${new Date().toISOString()}] Auto-start completed: "${result.greeting}"`);
        } else {
          console.error(`[${new Date().toISOString()}] Auto-start failed: ${result.message}`);
        }
      })
      .catch((err) => {
        console.error(`[${new Date().toISOString()}] Auto-start error:`, err);
      });
    return; // Only trigger for the first matching window
  }
}

/**
 * Warn the user if their window is ending soon.
 */
function warnIfWindowEnding(now: Date, windowEnd: string): void {
  const endDate = fromISO(windowEnd);
  const minutesLeft = diffMinutes(endDate, now);

  // Only warn if end is in the future
  if (endDate <= now) {
    return;
  }

  for (const warningMinutes of WINDOW_WARNING_MINUTES) {
    if (
      minutesLeft <= warningMinutes &&
      minutesLeft > warningMinutes - 1 &&
      isWindowWarningAllowed()
    ) {
      notifyWindowEnding(Math.round(minutesLeft));
      state.lastWindowEndWarning = now;
      break;
    }
  }
}

/**
 * Check if auto-start is allowed (respects cooldown period).
 * Reads from persisted state so it survives daemon restarts.
 */
export function isAutoStartAllowed(now: Date = new Date()): boolean {
  const lastAutoStart = getLastAutoStartTime();
  if (!lastAutoStart) {
    return true;
  }

  const diffMins = diffMinutes(now, lastAutoStart);
  return diffMins >= AUTOSTART_COOLDOWN_MINUTES;
}

/**
 * Check if a window is already active.
 * Uses cached usage first (if cache says active, trust it - windows don't end early).
 * Only fetches fresh usage if cache says no window (to catch recently started windows).
 */
export async function isWindowAlreadyActive(): Promise<boolean> {
  const now = new Date();

  // Check cache first - if it says we're in a window, trust it
  const cached = getCachedUsage();
  if (cached?.session.resets_at_iso) {
    const resetTime = new Date(cached.session.resets_at_iso);
    if (resetTime > now) {
      return true; // Cache confirms active window
    }
  }

  // Cache says no window (or stale) - fetch fresh to be sure
  const fresh = await getClaudeUsage({ refresh: true });
  if (!fresh?.session.resets_at_iso) {
    return false;
  }

  const resetTime = new Date(fresh.session.resets_at_iso);
  return resetTime > now;
}

/**
 * Check if window ending warning is allowed (don't spam warnings).
 */
function isWindowWarningAllowed(): boolean {
  if (!state.lastWindowEndWarning) {
    return true;
  }

  // Don't warn again within 2 minutes
  const now = new Date();
  const diffMins = diffMinutes(now, state.lastWindowEndWarning);
  return diffMins >= 2;
}
