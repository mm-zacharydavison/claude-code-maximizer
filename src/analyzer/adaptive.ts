import { loadConfig, updateConfig, type OptimalStartTimes, type DayOfWeek } from "../config/index.ts";
import { getHourlyUsageSince, getWindowsSince, getBaselineStat, setBaselineStat } from "../db/queries.ts";
import { dbExists } from "../db/client.ts";
import { toISO } from "../utils/time.ts";
import {
  buildProfileFromRecords,
  findOptimalTrigger,
  minutesToTimeString,
  parseTimeToMinutes,
  type HourlyProfile,
} from "./trigger-optimizer.ts";

// Re-analyze every 7 days
const ADJUSTMENT_INTERVAL_DAYS = 7;

export interface AdjustmentResult {
  adjusted: boolean;
  reason: string;
  changes: Array<{
    day: DayOfWeek;
    oldTime: string | null;
    newTime: string | null;
  }>;
  optimization: OptimizationInfo;
}

export interface OptimizationInfo {
  profileBuilt: boolean;
  bucketCount: number;
  minSlack: number;
  isValid: boolean;
}

/**
 * Checks if adaptive adjustment should run based on time since last adjustment
 */
export function shouldRunAdjustment(): boolean {
  const config = loadConfig();
  if (!config.auto_adjust_enabled) {
    return false;
  }

  const lastAdjustment = getBaselineStat("last_adjustment_timestamp");
  if (lastAdjustment === null) {
    return true; // Never adjusted before
  }

  const lastAdjustDate = new Date(lastAdjustment);
  const now = new Date();
  const daysSince = (now.getTime() - lastAdjustDate.getTime()) / (24 * 60 * 60 * 1000);

  return daysSince >= ADJUSTMENT_INTERVAL_DAYS;
}

/**
 * Build usage profile from recent database records
 */
function buildProfileFromDatabase(): HourlyProfile | null {
  if (!dbExists()) {
    return null;
  }

  // Get past 14 days of data
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 14);

  const hourlyRecords = getHourlyUsageSince(toISO(startDate));
  const windows = getWindowsSince(toISO(startDate));

  if (hourlyRecords.length < 10) {
    return null; // Insufficient data
  }

  return buildProfileFromRecords(hourlyRecords, windows);
}

/**
 * Runs adaptive adjustment using the TLA+ optimization algorithm.
 *
 * For each configured work day:
 * 1. Builds a usage profile from historical data
 * 2. Runs findOptimalTrigger to get optimal window start time
 * 3. Updates config with the new optimal times
 */
export function runAdaptiveAdjustment(): AdjustmentResult {
  const config = loadConfig();

  const noChangeResult = (reason: string): AdjustmentResult => ({
    adjusted: false,
    reason,
    changes: [],
    optimization: {
      profileBuilt: false,
      bucketCount: 0,
      minSlack: 0,
      isValid: false,
    },
  });

  if (!config.auto_adjust_enabled) {
    return noChangeResult("Auto-adjustment is disabled");
  }

  // Skip if manual hours are configured and usage blending is disabled
  if (config.working_hours.enabled && !config.working_hours.auto_adjust_from_usage) {
    return noChangeResult("Manual working hours configured without usage blending");
  }

  // Build profile from database
  const profile = buildProfileFromDatabase();
  if (!profile) {
    return noChangeResult("Insufficient usage data for optimization");
  }

  const changes: AdjustmentResult["changes"] = [];
  const updatedTimes: Partial<OptimalStartTimes> = {};
  let lastOptimization: OptimizationInfo = {
    profileBuilt: true,
    bucketCount: 0,
    minSlack: 0,
    isValid: false,
  };

  const { working_hours } = config;

  // Process each configured work day
  for (const day of working_hours.work_days) {
    const dayHours = working_hours.hours[day];
    if (!dayHours) continue;

    const workStartMins = parseTimeToMinutes(dayHours.start);
    const workEndMins = parseTimeToMinutes(dayHours.end);

    // Skip invalid configurations
    if (workEndMins <= workStartMins) continue;

    // Run TLA+ optimization algorithm
    const result = findOptimalTrigger(profile, workStartMins, workEndMins);

    lastOptimization = {
      profileBuilt: true,
      bucketCount: result.bucketCount,
      minSlack: result.minSlack,
      isValid: result.isValid,
    };

    // Get the first window start time as the optimal time
    const newTime = result.windows.length > 0
      ? minutesToTimeString(result.windows[0]!.start)
      : null;

    const currentTime = config.optimal_start_times[day];

    // Record change if different
    if (newTime !== currentTime) {
      changes.push({
        day,
        oldTime: currentTime,
        newTime,
      });
      updatedTimes[day] = newTime;
    }
  }

  // Apply changes if any
  if (changes.length > 0) {
    updateConfig({
      optimal_start_times: {
        ...config.optimal_start_times,
        ...updatedTimes,
      },
    });

    // Record adjustment timestamp
    setBaselineStat("last_adjustment_timestamp", Date.now());

    // Track adjustment count
    const adjustmentCount = getBaselineStat("adjustment_count") ?? 0;
    setBaselineStat("adjustment_count", adjustmentCount + 1);
  }

  return {
    adjusted: changes.length > 0,
    reason: changes.length > 0
      ? `Adjusted ${changes.length} day(s) using TLA+ optimization`
      : "No changes needed - current times are optimal",
    changes,
    optimization: lastOptimization,
  };
}

/**
 * Formats adjustment result for display
 */
export function formatAdjustmentResult(result: AdjustmentResult): string {
  const lines: string[] = [];

  lines.push("Adaptive Adjustment Report");
  lines.push("─".repeat(50));
  lines.push("");

  if (!result.adjusted) {
    lines.push(`Status: No changes made`);
    lines.push(`Reason: ${result.reason}`);
  } else {
    lines.push(`Status: Updated ${result.changes.length} day(s)`);
    lines.push("");
    lines.push("Changes:");

    for (const change of result.changes) {
      const dayName = change.day.charAt(0).toUpperCase() + change.day.slice(1);
      const oldDisplay = change.oldTime ?? "(none)";
      const newDisplay = change.newTime ?? "(none)";
      lines.push(`  ${dayName.padEnd(12)} ${oldDisplay} → ${newDisplay}`);
    }
  }

  if (result.optimization.profileBuilt) {
    lines.push("");
    lines.push("Optimization:");
    lines.push(`  Buckets:    ${result.optimization.bucketCount}`);
    lines.push(`  Min slack:  ${result.optimization.minSlack.toFixed(0)}%`);
    lines.push(`  Valid:      ${result.optimization.isValid ? "yes" : "no (fallback used)"}`);
  }

  return lines.join("\n");
}

/**
 * Gets the last adjustment information
 */
export function getLastAdjustmentInfo(): {
  timestamp: Date | null;
  count: number;
  daysSince: number | null;
} {
  const lastTimestamp = getBaselineStat("last_adjustment_timestamp");
  const count = getBaselineStat("adjustment_count") ?? 0;

  if (lastTimestamp === null) {
    return {
      timestamp: null,
      count: 0,
      daysSince: null,
    };
  }

  const lastDate = new Date(lastTimestamp);
  const now = new Date();
  const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));

  return {
    timestamp: lastDate,
    count,
    daysSince,
  };
}
