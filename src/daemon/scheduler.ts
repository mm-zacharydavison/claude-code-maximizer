import { loadConfig, type OptimalStartTimes } from "../config/index.ts";
import { loadState } from "../config/state.ts";
import { getCurrentWindow } from "../db/queries.ts";
import { getDayOfWeek, fromISO, diffMinutes } from "../utils/time.ts";
import { notifyOptimalTime, notifyWindowEnding } from "./notifier.ts";
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
    const dayOfWeek = getDayOfWeek(now) as keyof OptimalStartTimes;
    const optimalTime = config.optimal_start_times[dayOfWeek];

    // Check for optimal start time notification
    if (optimalTime && !appState.current_window_start) {
      safeExecute("scheduler:checkOptimalStartTime", () => {
        checkOptimalStartTime(now, optimalTime);
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

function checkOptimalStartTime(now: Date, optimalTime: string): void {
  const [hours, minutes] = optimalTime.split(":").map(Number);
  if (hours === undefined || minutes === undefined) return;

  const optimalDate = new Date(now);
  optimalDate.setHours(hours, minutes, 0, 0);

  // Check if we're within 5 minutes of optimal time
  const diffMins = diffMinutes(now, optimalDate);

  if (diffMins <= 5 && shouldNotify(state.lastNotificationTime)) {
    notifyOptimalTime(optimalTime);
    state.lastNotificationTime = now;
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
