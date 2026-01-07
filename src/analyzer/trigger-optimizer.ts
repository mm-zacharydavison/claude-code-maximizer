/**
 * Trigger Optimizer - TLA+ Algorithm Implementation
 *
 * This module implements the rate limit optimizer algorithm as specified in
 * the TLA+ specification (tla-spec/rate_limit_optimizer.tla).
 *
 * The algorithm finds the optimal window trigger time that:
 * 1. Ensures no window exceeds quota (valid trigger)
 * 2. Maximizes the number of usable buckets/windows
 * 3. Maximizes minimum slack (safety margin) as a tiebreaker
 */

// Constants matching TLA+ spec
export const QUOTA = 100; // Maximum usage per window (normalized to 100%)
export const WINDOW_SIZE = 300; // Window duration in minutes (5 hours)
export const TIME_GRANULARITY = 15; // Granularity for trigger search in minutes
export const CALIBRATION_DAYS = 7; // Days to collect data before optimization

/**
 * Usage profile: expected usage per hour bucket (0-23)
 * Values are in percentage points (0-100 scale)
 */
export type HourlyProfile = Record<number, number>;

/**
 * Window with work overlap information
 */
export interface Window {
  start: number; // Window start in minutes from midnight
  end: number; // Window end in minutes from midnight
  workOverlapStart: number; // Start of work overlap
  workOverlapEnd: number; // End of work overlap
}

/**
 * Result of the optimization algorithm
 */
export interface OptimizationResult {
  triggerTime: number; // Optimal trigger time in minutes from midnight
  triggerTimeFormatted: string; // HH:MM format
  bucketCount: number; // Number of usable windows
  minSlack: number; // Minimum slack across all windows
  isValid: boolean; // Whether any valid trigger was found
  windows: Window[]; // Windows for the optimal trigger
}

/**
 * Default usage profile when unknown (conservative uniform assumption)
 * Spreads quota across ~10 work hours
 */
export function getDefaultProfile(): HourlyProfile {
  const profile: HourlyProfile = {};
  for (let h = 0; h < 24; h++) {
    profile[h] = QUOTA / 10; // 10% per hour as conservative default
  }
  return profile;
}

/**
 * Clamp value to range [lo, hi]
 */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Convert minutes from midnight to HH:MM format
 */
export function minutesToTimeString(minutes: number): string {
  // Normalize to 0-24h range
  let normalized = minutes % (24 * 60);
  if (normalized < 0) normalized += 24 * 60;

  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * Parse time string (HH:MM) to minutes from midnight
 */
export function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Generate window boundaries for a given trigger time across a workday.
 *
 * The trigger time is when the first window starts. Subsequent windows
 * start every WINDOW_SIZE minutes.
 *
 * @param triggerMinutes - Trigger time in minutes from midnight
 * @param workStart - Work start in minutes from midnight
 * @param workEnd - Work end in minutes from midnight
 * @returns Array of windows that have overlap with work hours
 */
export function windowsForTrigger(
  triggerMinutes: number,
  workStart: number,
  workEnd: number
): Window[] {
  const windows: Window[] = [];

  // Generate windows starting from trigger time
  // Each window is WINDOW_SIZE minutes long
  // We generate enough windows to cover the workday
  for (let n = 0; n <= 5; n++) {
    const windowStart = triggerMinutes + WINDOW_SIZE * n;
    const windowEnd = windowStart + WINDOW_SIZE;

    // Calculate overlap with work hours
    const workOverlapStart = clamp(windowStart, workStart, workEnd);
    const workOverlapEnd = clamp(windowEnd, workStart, workEnd);

    // Only include windows that have actual work overlap
    if (workOverlapEnd > workOverlapStart) {
      windows.push({
        start: windowStart,
        end: windowEnd,
        workOverlapStart,
        workOverlapEnd,
      });
    }
  }

  return windows;
}

/**
 * Calculate expected usage in a window given a profile.
 *
 * Sums the profile values for hours that fall within the work overlap
 * portion of the window.
 *
 * @param profile - Hourly usage profile
 * @param window - Window to calculate usage for
 * @returns Expected usage as a percentage (0-100+)
 */
export function expectedWindowUsage(profile: HourlyProfile, window: Window): number {
  let totalUsage = 0;

  // Iterate through hours that overlap with the work portion of this window
  for (let h = 0; h < 24; h++) {
    const hourStart = h * 60;
    const hourEnd = (h + 1) * 60;

    // Calculate overlap between this hour and the work overlap of the window
    const overlapStart = Math.max(hourStart, window.workOverlapStart);
    const overlapEnd = Math.min(hourEnd, window.workOverlapEnd);

    if (overlapEnd > overlapStart) {
      // This hour has overlap with the window's work portion
      // Weight the usage by the fraction of the hour that overlaps
      const overlapFraction = (overlapEnd - overlapStart) / 60;
      totalUsage += (profile[h] ?? 0) * overlapFraction;
    }
  }

  return totalUsage;
}

/**
 * Check if a trigger time is valid (no window exceeds quota).
 *
 * A trigger is valid if:
 * 1. It produces at least one window overlapping work hours
 * 2. No window exceeds quota
 *
 * @param profile - Hourly usage profile
 * @param triggerMinutes - Trigger time in minutes from midnight
 * @param workStart - Work start in minutes from midnight
 * @param workEnd - Work end in minutes from midnight
 * @returns true if trigger produces useful windows and all are within quota
 */
export function isValidTrigger(
  profile: HourlyProfile,
  triggerMinutes: number,
  workStart: number,
  workEnd: number
): boolean {
  const windows = windowsForTrigger(triggerMinutes, workStart, workEnd);

  // A trigger that produces no windows is not useful
  if (windows.length === 0) {
    return false;
  }

  for (const window of windows) {
    if (expectedWindowUsage(profile, window) > QUOTA) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate minimum slack across all windows for a trigger.
 *
 * Slack = QUOTA - expected_usage for each window.
 * Returns the minimum slack, which represents the safety margin.
 *
 * @param profile - Hourly usage profile
 * @param triggerMinutes - Trigger time in minutes from midnight
 * @param workStart - Work start in minutes from midnight
 * @param workEnd - Work end in minutes from midnight
 * @returns Minimum slack across all windows (can be negative if invalid)
 */
export function minSlack(
  profile: HourlyProfile,
  triggerMinutes: number,
  workStart: number,
  workEnd: number
): number {
  const windows = windowsForTrigger(triggerMinutes, workStart, workEnd);

  if (windows.length === 0) {
    return 0;
  }

  let minSlackValue = Infinity;

  for (const window of windows) {
    const usage = expectedWindowUsage(profile, window);
    const slack = QUOTA - usage;
    if (slack < minSlackValue) {
      minSlackValue = slack;
    }
  }

  return minSlackValue === Infinity ? 0 : minSlackValue;
}

/**
 * Find the optimal trigger time.
 *
 * Priority (from TLA+ spec):
 * 1. Valid (no overruns) - trigger must not cause any window to exceed quota
 * 2. Max buckets - maximize the number of usable windows
 * 3. Max min-slack - among equal bucket counts, maximize safety margin
 *
 * @param profile - Hourly usage profile
 * @param workStart - Work start in minutes from midnight
 * @param workEnd - Work end in minutes from midnight
 * @returns Optimization result with best trigger time
 */
export function findOptimalTrigger(
  profile: HourlyProfile,
  workStart: number,
  workEnd: number
): OptimizationResult {
  // Generate candidate trigger times at TIME_GRANULARITY intervals
  // Candidates range from 0 (midnight) to workStart
  // We search before workStart to allow windows to "warm up" before work begins
  const candidates: number[] = [];
  for (let t = 0; t <= workStart; t += TIME_GRANULARITY) {
    candidates.push(t);
  }

  // Also check some times before midnight (negative, wrapped to previous day)
  // This handles cases where optimal trigger is late evening
  for (let t = -WINDOW_SIZE; t < 0; t += TIME_GRANULARITY) {
    candidates.push(t + 24 * 60); // Wrap to positive time
  }

  // Filter to valid triggers
  const validCandidates = candidates.filter((t) =>
    isValidTrigger(profile, t, workStart, workEnd)
  );

  // If no valid triggers, fall back to workStart
  if (validCandidates.length === 0) {
    const windows = windowsForTrigger(workStart, workStart, workEnd);
    return {
      triggerTime: workStart,
      triggerTimeFormatted: minutesToTimeString(workStart),
      bucketCount: windows.length,
      minSlack: minSlack(profile, workStart, workStart, workEnd),
      isValid: false,
      windows,
    };
  }

  // Find the best valid trigger
  // Priority: max bucket count, then max min-slack
  let bestTrigger = validCandidates[0]!;
  let bestBucketCount = windowsForTrigger(bestTrigger, workStart, workEnd).length;
  let bestMinSlack = minSlack(profile, bestTrigger, workStart, workEnd);

  for (const trigger of validCandidates) {
    const bucketCount = windowsForTrigger(trigger, workStart, workEnd).length;
    const slack = minSlack(profile, trigger, workStart, workEnd);

    // Better if: more buckets, or same buckets with more slack
    if (
      bucketCount > bestBucketCount ||
      (bucketCount === bestBucketCount && slack > bestMinSlack)
    ) {
      bestTrigger = trigger;
      bestBucketCount = bucketCount;
      bestMinSlack = slack;
    }
  }

  const windows = windowsForTrigger(bestTrigger, workStart, workEnd);

  return {
    triggerTime: bestTrigger,
    triggerTimeFormatted: minutesToTimeString(bestTrigger),
    bucketCount: bestBucketCount,
    minSlack: bestMinSlack,
    isValid: true,
    windows,
  };
}

/**
 * Usage log entry: usage amount for a specific (day, hour) combination
 */
export interface UsageLogEntry {
  day: number; // Day index (0, 1, 2, ...)
  hour: number; // Hour bucket (0-23)
  usage: number; // Usage amount (percentage points)
}

/**
 * Compute mean usage for an hour bucket from logged data.
 *
 * @param log - Array of usage log entries
 * @param hour - Hour bucket (0-23)
 * @returns Mean usage for that hour across all days
 */
export function computeHourlyMean(log: UsageLogEntry[], hour: number): number {
  const entries = log.filter((e) => e.hour === hour);

  if (entries.length === 0) {
    return 0;
  }

  const sum = entries.reduce((acc, e) => acc + e.usage, 0);
  return sum / entries.length;
}

/**
 * Build full usage profile from usage log.
 *
 * @param log - Array of usage log entries
 * @returns Hourly profile with mean usage per hour bucket
 */
export function buildProfile(log: UsageLogEntry[]): HourlyProfile {
  const profile: HourlyProfile = {};

  for (let h = 0; h < 24; h++) {
    profile[h] = computeHourlyMean(log, h);
  }

  return profile;
}

/**
 * System phase as defined in TLA+ spec
 */
export type Phase = "bootstrap" | "calibrate" | "steady_state";

// ============================================================================
// Profile Building from Historical Data
// ============================================================================

/**
 * Hourly usage record from database
 */
export interface HourlyUsageRecord {
  date_hour: string; // Format: YYYY-MM-DD-HH
  usage_pct: number; // Cumulative usage percentage (0-100)
  updated_at: string;
}

/**
 * Usage window record from database
 */
export interface UsageWindowRecord {
  id: number;
  window_start: string; // ISO timestamp
  window_end: string; // ISO timestamp
}

/**
 * Parse date_hour format (YYYY-MM-DD-HH) into components
 */
function parseDateHour(dateHour: string): { date: string; hour: number; timestamp: Date } {
  const parts = dateHour.split("-");
  const date = `${parts[0]}-${parts[1]}-${parts[2]}`;
  const hour = parseInt(parts[3] ?? "0", 10);
  const timestamp = new Date(`${date}T${hour.toString().padStart(2, "0")}:00:00`);
  return { date, hour, timestamp };
}

/**
 * Find which window a timestamp belongs to
 */
function findWindowForTimestamp(
  timestamp: Date,
  windows: UsageWindowRecord[]
): UsageWindowRecord | null {
  for (const window of windows) {
    const start = new Date(window.window_start);
    const end = new Date(window.window_end);
    if (timestamp >= start && timestamp < end) {
      return window;
    }
  }
  return null;
}

/**
 * Compute actual per-hour usage from cumulative hourly records.
 *
 * The database stores MAX cumulative usage per hour slot. To get actual
 * usage in each hour, we compute the diff from the previous hour within
 * the same window. At window boundaries, usage resets to 0.
 *
 * @param hourlyRecords - Hourly usage records from database
 * @param windows - Usage windows from database
 * @returns Array of UsageLogEntry with actual per-hour usage
 */
export function computeActualHourlyUsage(
  hourlyRecords: HourlyUsageRecord[],
  windows: UsageWindowRecord[]
): UsageLogEntry[] {
  if (hourlyRecords.length === 0) {
    return [];
  }

  // Sort records by timestamp
  const sorted = [...hourlyRecords].sort((a, b) =>
    a.date_hour.localeCompare(b.date_hour)
  );

  // Sort windows by start time
  const sortedWindows = [...windows].sort((a, b) =>
    a.window_start.localeCompare(b.window_start)
  );

  const result: UsageLogEntry[] = [];

  // Group by day for day index calculation
  const daySet = new Set<string>();
  for (const record of sorted) {
    const { date } = parseDateHour(record.date_hour);
    daySet.add(date);
  }
  const days = Array.from(daySet).sort();
  const dayIndex = new Map<string, number>();
  days.forEach((d, i) => dayIndex.set(d, i));

  // Track previous cumulative value per window
  let prevWindowId: number | null = null;
  let prevCumulative = 0;

  for (const record of sorted) {
    const { date, hour, timestamp } = parseDateHour(record.date_hour);
    const window = findWindowForTimestamp(timestamp, sortedWindows);

    // Check if we're in a new window
    const windowId = window?.id ?? null;
    if (windowId !== prevWindowId) {
      // New window - cumulative resets
      prevCumulative = 0;
      prevWindowId = windowId;
    }

    // Actual usage this hour = current cumulative - previous cumulative
    const actualUsage = Math.max(0, record.usage_pct - prevCumulative);

    // Update previous cumulative
    prevCumulative = record.usage_pct;

    // Add to result
    const day = dayIndex.get(date) ?? 0;
    result.push({
      day,
      hour,
      usage: actualUsage,
    });
  }

  return result;
}

/**
 * Build a usage profile from historical database records.
 *
 * This is the main entry point for building profiles from real data.
 *
 * @param hourlyRecords - Hourly usage records from database
 * @param windows - Usage windows from database
 * @returns Hourly profile suitable for findOptimalTrigger
 */
export function buildProfileFromRecords(
  hourlyRecords: HourlyUsageRecord[],
  windows: UsageWindowRecord[]
): HourlyProfile {
  const usageLog = computeActualHourlyUsage(hourlyRecords, windows);
  return buildProfile(usageLog);
}

/**
 * Get wait events from historical data.
 *
 * A wait event occurs when usage hit 100% before the window end.
 *
 * @param hourlyRecords - Hourly usage records from database
 * @param windows - Usage windows from database
 * @returns Number of wait events
 */
export function countWaitEvents(
  hourlyRecords: HourlyUsageRecord[],
  windows: UsageWindowRecord[]
): number {
  let waitEvents = 0;

  for (const window of windows) {
    const windowEnd = new Date(window.window_end);

    // Find max usage in this window before it ended
    let maxUsageBeforeEnd = 0;
    let foundUsageBeforeEnd = false;

    for (const record of hourlyRecords) {
      const { timestamp } = parseDateHour(record.date_hour);
      const recordEnd = new Date(timestamp.getTime() + 60 * 60 * 1000); // End of this hour

      if (timestamp >= new Date(window.window_start) && recordEnd < windowEnd) {
        foundUsageBeforeEnd = true;
        if (record.usage_pct > maxUsageBeforeEnd) {
          maxUsageBeforeEnd = record.usage_pct;
        }
      }
    }

    // If max usage was 100% before window end, that's a wait event
    if (foundUsageBeforeEnd && maxUsageBeforeEnd >= 100) {
      waitEvents++;
    }
  }

  return waitEvents;
}

/**
 * Calculate wasted quota from historical data.
 *
 * Wasted quota is the remaining unused quota when a window resets.
 *
 * @param hourlyRecords - Hourly usage records from database
 * @param windows - Usage windows from database
 * @returns Total wasted quota (percentage points)
 */
export function calculateWastedQuota(
  hourlyRecords: HourlyUsageRecord[],
  windows: UsageWindowRecord[]
): number {
  let wastedQuota = 0;

  for (const window of windows) {
    const windowEnd = new Date(window.window_end);
    const windowStart = new Date(window.window_start);

    // Find the last usage record in this window
    let lastUsage = 0;
    let foundUsage = false;

    for (const record of hourlyRecords) {
      const { timestamp } = parseDateHour(record.date_hour);

      if (timestamp >= windowStart && timestamp < windowEnd) {
        foundUsage = true;
        lastUsage = record.usage_pct;
      }
    }

    // Wasted = 100 - last usage (if any usage was recorded)
    if (foundUsage && lastUsage < 100) {
      wastedQuota += 100 - lastUsage;
    }
  }

  return wastedQuota;
}

/**
 * Determine system phase based on day count.
 *
 * @param dayCount - Number of days with recorded data
 * @param calibrationDays - Days required before optimization (default: CALIBRATION_DAYS)
 * @returns Current system phase
 */
export function determinePhase(dayCount: number, calibrationDays: number = CALIBRATION_DAYS): Phase {
  if (dayCount < calibrationDays) {
    return "bootstrap";
  }
  return "steady_state";
}

/**
 * Calculate optimal start times for a workday using the TLA+ algorithm.
 *
 * This is the main entry point that replaces the existing calculateOptimalStartTimes.
 *
 * @param workStart - Work start time in HH:MM format
 * @param workEnd - Work end time in HH:MM format
 * @param profile - Optional usage profile (uses default if not provided)
 * @returns Array of optimal start times in HH:MM format
 */
export function calculateOptimalStartTimesFromProfile(
  workStart: string,
  workEnd: string,
  profile?: HourlyProfile
): string[] {
  const workStartMins = parseTimeToMinutes(workStart);
  const workEndMins = parseTimeToMinutes(workEnd);

  // Handle invalid input (work end before/equal to start)
  if (workEndMins <= workStartMins) {
    return [workStart];
  }

  const usageProfile = profile ?? getDefaultProfile();
  const result = findOptimalTrigger(usageProfile, workStartMins, workEndMins);

  // Return all window start times
  return result.windows.map((w) => minutesToTimeString(w.start));
}
