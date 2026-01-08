import { spawn } from "bun";
import { upsertHourlyUsage, createWindow, getCurrentWindow, updateWindowUtilization, updateWindowEnd } from "../db/queries.ts";
import { loadState, setCurrentWindowStart, setCurrentWindowEnd } from "../config/state.ts";
import { now, addHours, toISO, fromISO } from "../utils/time.ts";
import { INSTALLED_BINARY_PATH } from "../utils/paths.ts";
import { getCachedUsage } from "../usage/index.ts";
import { safeExecute, logDebug } from "../utils/errors.ts";

export type EventType = "pre_tool" | "post_tool" | "prompt_submit";

/**
 * Handles hook events from Claude Code.
 * This function MUST be resilient - any failure should be logged and swallowed
 * to avoid impacting Claude Code performance.
 */
export function handleHookEvent(eventType: EventType, _toolName?: string): void {
  // Only record on prompt_submit to reduce noise
  if (eventType !== "prompt_submit") {
    return;
  }

  const timestamp = now();

  // Get current usage percentage from cache
  const usage = getCachedUsage();
  const usagePct = usage?.session?.percentage;

  logDebug("hook", "handleHookEvent called", { eventType, timestamp, usagePct });

  // Update hourly max usage - wrapped in safe execute
  if (usagePct !== undefined && usagePct !== null) {
    safeExecute("hook:upsertHourlyUsage", () => {
      upsertHourlyUsage(usagePct);
      logDebug("hook", "Hourly usage updated", { usagePct });
    });
  }

  // Check if we need to start a new window - wrapped in safe execute
  safeExecute("hook:ensureActiveWindow", () => {
    ensureActiveWindow(timestamp);
  });

  // Trigger background refresh of usage cache
  safeExecute("hook:triggerBackgroundUsageRefresh", () => {
    triggerBackgroundUsageRefresh();
  });
}

function triggerBackgroundUsageRefresh(): void {
  try {
    // Spawn ccmax usage --refresh in background, detached from this process
    // The process will wait if Claude is busy and refresh when available
    const proc = spawn([INSTALLED_BINARY_PATH, "usage", "--refresh"], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    // Unref so the parent process doesn't wait for it
    proc.unref();
  } catch {
    // Silently ignore errors - this is best-effort
  }
}

function ensureActiveWindow(timestamp: string): void {
  const state = loadState();
  const currentWindow = getCurrentWindow();

  logDebug("hook", "ensureActiveWindow", {
    timestamp,
    hasCurrentWindow: !!currentWindow,
    stateWindowStart: state.current_window_start,
    stateWindowEnd: state.current_window_end,
  });

  if (!currentWindow) {
    // No active window - check if we should start one
    if (!state.current_window_start) {
      // First activity - start a new window
      logDebug("hook", "No window exists, starting new window");
      startNewWindow(timestamp);
    } else {
      // Check if previous window has expired
      // Use cached window end from Claude, or fall back to 5-hour calculation
      let windowEnd: Date;
      if (state.current_window_end) {
        windowEnd = fromISO(state.current_window_end);
      } else {
        const windowStart = fromISO(state.current_window_start);
        windowEnd = addHours(windowStart, 5);
      }

      if (fromISO(timestamp) >= windowEnd) {
        // Window expired - start a new one
        logDebug("hook", "Window expired, starting new window", {
          timestamp,
          windowEnd: toISO(windowEnd),
        });
        startNewWindow(timestamp);
      } else {
        logDebug("hook", "Window not expired but no currentWindow in DB", {
          timestamp,
          windowEnd: toISO(windowEnd),
        });
      }
    }
  } else {
    // Update utilization for current window
    logDebug("hook", "Updating existing window stats", {
      windowId: currentWindow.id,
    });
    updateWindowStats(currentWindow.id);

    // Update window end from cached usage if available and different
    updateWindowEndFromCache();
  }
}

function updateWindowEndFromCache(): void {
  const usage = getCachedUsage();
  logDebug("hook", "updateWindowEndFromCache", {
    hasUsage: !!usage,
    resets_at_iso: usage?.session?.resets_at_iso,
    percentage: usage?.session?.percentage,
  });

  if (usage?.session?.resets_at_iso) {
    const state = loadState();
    if (state.current_window_end !== usage.session.resets_at_iso) {
      logDebug("hook", "Updating window end from cache", {
        old: state.current_window_end,
        new: usage.session.resets_at_iso,
      });
      setCurrentWindowEnd(usage.session.resets_at_iso);
      // Also update the database window record
      const currentWindow = getCurrentWindow();
      if (currentWindow) {
        updateWindowEnd(currentWindow.id, usage.session.resets_at_iso);
      }
    }
  }
}

function startNewWindow(timestamp: string): void {
  const windowStart = timestamp;
  const windowStartDate = fromISO(timestamp);

  // Try to get window end from cached usage data
  const usage = getCachedUsage();
  let windowEnd: string;
  let isCacheStale = false;

  if (usage?.session?.resets_at_iso) {
    const cachedEnd = fromISO(usage.session.resets_at_iso);
    // Only use cached reset time if it's significantly in the future (at least 30 min)
    // This prevents using stale cache data from a previous session that just expired
    const thirtyMinutes = 30 * 60 * 1000;
    if (cachedEnd.getTime() - windowStartDate.getTime() > thirtyMinutes) {
      windowEnd = usage.session.resets_at_iso;
      logDebug("hook", "startNewWindow using cached reset time", {
        windowStart,
        windowEnd,
        percentage: usage.session.percentage,
      });
    } else {
      // Cached reset time is stale or too close, use calculated window
      // Also mark cache as stale so we don't use the old percentage
      isCacheStale = true;
      windowEnd = toISO(addHours(windowStartDate, 5));
      logDebug("hook", "startNewWindow using calculated 5h window (stale cache)", {
        windowStart,
        windowEnd,
        staleResetTime: usage.session.resets_at_iso,
      });
    }
  } else {
    // Fall back to calculated 5-hour window
    windowEnd = toISO(addHours(windowStartDate, 5));
    logDebug("hook", "startNewWindow using calculated 5h window (no cache)", {
      windowStart,
      windowEnd,
    });
  }

  const windowId = createWindow(windowStart, windowEnd);
  setCurrentWindowStart(windowStart);
  setCurrentWindowEnd(windowEnd);

  // Update the new window with initial stats
  // Don't use cached percentage if cache is stale (reset time in the past)
  const initialPercentage = isCacheStale ? undefined : usage?.session?.percentage ?? undefined;
  updateWindowUtilization(windowId, 1, initialPercentage);

  logDebug("hook", "Window created and state updated", { windowStart, windowEnd });
}

function updateWindowStats(windowId: number): void {
  // Get Claude's actual usage percentage from cache
  const usage = getCachedUsage();
  const claudeUsagePct = usage?.session?.percentage;

  // Get current window to increment active minutes
  const currentWindow = getCurrentWindow();
  const currentActiveMinutes = currentWindow?.active_minutes ?? 0;

  // Each prompt counts as ~1 minute of activity
  updateWindowUtilization(windowId, currentActiveMinutes + 1, claudeUsagePct ?? undefined);
}
