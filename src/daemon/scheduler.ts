import { loadConfig, type DayOfWeek } from "../config/index.ts";
import { loadState } from "../config/state.ts";
import { getCurrentWindow } from "../db/queries.ts";
import { getDayOfWeek, fromISO, diffMinutes, calculateOptimalStartTimes } from "../utils/time.ts";
import { notifyWindowEnding } from "./notifier.ts";
import { spawnClaudeSession } from "./autostart.ts";
import { safeExecute, logError } from "../utils/errors.ts";

export interface SchedulerState {
  lastNotificationTime: Date | null;
  lastWindowEndWarning: Date | null;
}

const state: SchedulerState = {
  lastNotificationTime: null,
  lastWindowEndWarning: null,
};

const NOTIFICATION_COOLDOWN_MINUTES = 60;
const WINDOW_WARNING_MINUTES = [30, 15, 5];

export function checkAndNotify(): void {
  // Wrap entire scheduler check in try-catch to prevent daemon crashes
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

    // Check for optimal start time notification (when no window is active)
    if (optimalTimes.length > 0 && !appState.current_window_start) {
      safeExecute("scheduler:checkOptimalStartTime", () => {
        checkOptimalStartTimes(now, optimalTimes);
      });
    }

    // Check for window ending notification
    safeExecute("scheduler:checkWindowEnding", () => {
      const currentWindow = getCurrentWindow();
      if (currentWindow) {
        checkWindowEnding(now, currentWindow.window_end);
      }
    });
  } catch (error) {
    logError("scheduler:checkAndNotify", error);
  }
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
 * Check if current time is within 5 minutes of any optimal start time.
 * If so, spawn a Claude session to start the usage window.
 */
function checkOptimalStartTimes(now: Date, optimalTimes: string[]): void {
  for (const optimalTime of optimalTimes) {
    const [hours, minutes] = optimalTime.split(":").map(Number);
    if (hours === undefined || minutes === undefined) continue;

    const optimalDate = new Date(now);
    optimalDate.setHours(hours, minutes, 0, 0);

    // Check if we're within 5 minutes of this optimal time
    const diffMins = diffMinutes(now, optimalDate);

    if (diffMins <= 5 && shouldNotify(state.lastNotificationTime)) {
      console.log(`[${now.toISOString()}] Auto-starting Claude session at optimal time ${optimalTime}`);
      // Fire and forget - don't block the scheduler
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
      state.lastNotificationTime = now;
      return; // Only trigger for the first matching time
    }
  }
}

function checkWindowEnding(now: Date, windowEnd: string): void {
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
      shouldWarnWindowEnd(state.lastWindowEndWarning, warningMinutes)
    ) {
      notifyWindowEnding(Math.round(minutesLeft));
      state.lastWindowEndWarning = now;
      break;
    }
  }
}

function shouldNotify(lastNotification: Date | null): boolean {
  if (!lastNotification) {
    return true;
  }

  const now = new Date();
  const diffMins = diffMinutes(now, lastNotification);
  return diffMins >= NOTIFICATION_COOLDOWN_MINUTES;
}

function shouldWarnWindowEnd(lastWarning: Date | null, _warningMinutes: number): boolean {
  if (!lastWarning) {
    return true;
  }

  // Don't warn again within 2 minutes
  const now = new Date();
  const diffMins = diffMinutes(now, lastWarning);
  return diffMins >= 2;
}
