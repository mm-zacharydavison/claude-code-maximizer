import { loadConfig, updateConfig, type OptimalStartTimes } from "../config/index.ts";
import { getHourlyUsageSince, getBaselineStat, setBaselineStat } from "../db/queries.ts";
import { dbExists } from "../db/client.ts";
import { toISO } from "../utils/time.ts";
import { aggregateByDay, getWeekdayDistribution } from "./aggregator.ts";
import { analyzeWeeklyPatterns } from "./patterns.ts";
import { formatTimeFromHourMinute } from "./optimizer.ts";

// Exponential moving average smoothing factor (0-1)
// Higher = more weight on new data, lower = more stable
const EMA_ALPHA = 0.3;

// Re-analyze every 7 days
const ADJUSTMENT_INTERVAL_DAYS = 7;

export interface AdjustmentResult {
  adjusted: boolean;
  reason: string;
  changes: Array<{
    day: string;
    oldTime: string | null;
    newTime: string | null;
    blendedTime: string | null;
  }>;
  trends: TrendAnalysis;
}

export interface TrendAnalysis {
  shiftsDetected: boolean;
  direction: "earlier" | "later" | "stable";
  avgShiftMinutes: number;
  consistencyTrend: "improving" | "declining" | "stable";
}

interface TimeMinutes {
  hour: number;
  minute: number;
  totalMinutes: number;
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
 * Parses time string "HH:MM" to minutes from midnight
 */
function parseTimeToMinutes(time: string | null): TimeMinutes | null {
  if (!time) return null;

  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hour = parseInt(match[1]!, 10);
  const minute = parseInt(match[2]!, 10);

  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

/**
 * Converts minutes from midnight back to "HH:MM" format
 */
function minutesToTime(totalMinutes: number): string {
  // Handle negative or overflow values
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;

  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return formatTimeFromHourMinute(hour, minute);
}

/**
 * Blends two times using exponential moving average
 */
function blendTimes(
  currentTime: string | null,
  newTime: string | null,
  alpha: number = EMA_ALPHA
): string | null {
  const current = parseTimeToMinutes(currentTime);
  const newT = parseTimeToMinutes(newTime);

  // If no current time, use new time directly
  if (!current) return newTime;

  // If no new time, keep current
  if (!newT) return currentTime;

  // EMA: blended = α * new + (1 - α) * current
  const blendedMinutes = Math.round(alpha * newT.totalMinutes + (1 - alpha) * current.totalMinutes);

  return minutesToTime(blendedMinutes);
}

/**
 * Calculates the difference in minutes between two times
 */
function timeDifferenceMinutes(time1: string | null, time2: string | null): number {
  const t1 = parseTimeToMinutes(time1);
  const t2 = parseTimeToMinutes(time2);

  if (!t1 || !t2) return 0;

  return t2.totalMinutes - t1.totalMinutes;
}

/**
 * Analyzes trends in usage patterns
 */
function analyzeTrends(
  currentTimes: OptimalStartTimes,
  newRecommendations: Map<string, { hour: number; minute: number } | null>
): TrendAnalysis {
  const shifts: number[] = [];

  for (const [day, newRec] of newRecommendations) {
    const currentTime = currentTimes[day as keyof OptimalStartTimes];
    if (!currentTime || !newRec) continue;

    const newTime = formatTimeFromHourMinute(newRec.hour, newRec.minute);
    const diff = timeDifferenceMinutes(currentTime, newTime);
    if (diff !== 0) {
      shifts.push(diff);
    }
  }

  if (shifts.length === 0) {
    return {
      shiftsDetected: false,
      direction: "stable",
      avgShiftMinutes: 0,
      consistencyTrend: "stable",
    };
  }

  const avgShift = shifts.reduce((a, b) => a + b, 0) / shifts.length;

  return {
    shiftsDetected: Math.abs(avgShift) > 15, // More than 15 min shift is significant
    direction: avgShift < -15 ? "earlier" : avgShift > 15 ? "later" : "stable",
    avgShiftMinutes: Math.round(avgShift),
    consistencyTrend: "stable", // Could be enhanced with variance tracking
  };
}

/**
 * Runs adaptive adjustment on optimal start times
 * Blends new recommendations with current settings using EMA
 */
export function runAdaptiveAdjustment(): AdjustmentResult {
  const config = loadConfig();

  if (!config.auto_adjust_enabled) {
    return {
      adjusted: false,
      reason: "Auto-adjustment is disabled",
      changes: [],
      trends: {
        shiftsDetected: false,
        direction: "stable",
        avgShiftMinutes: 0,
        consistencyTrend: "stable",
      },
    };
  }

  if (!dbExists()) {
    return {
      adjusted: false,
      reason: "No usage data available",
      changes: [],
      trends: {
        shiftsDetected: false,
        direction: "stable",
        avgShiftMinutes: 0,
        consistencyTrend: "stable",
      },
    };
  }

  // Get recent data (past 2 weeks for adjustment)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 14);
  const hourlyRecords = getHourlyUsageSince(toISO(startDate));

  if (hourlyRecords.length < 10) {
    return {
      adjusted: false,
      reason: "Insufficient recent data for adjustment",
      changes: [],
      trends: {
        shiftsDetected: false,
        direction: "stable",
        avgShiftMinutes: 0,
        consistencyTrend: "stable",
      },
    };
  }

  // Analyze patterns
  const dailyUsage = aggregateByDay(hourlyRecords);
  const weekdayData = getWeekdayDistribution(dailyUsage);
  const patterns = analyzeWeeklyPatterns(weekdayData);

  // Build new recommendations map
  const newRecommendations = new Map<string, { hour: number; minute: number } | null>();
  for (const [day, rec] of patterns.recommendations) {
    if (rec.windows.length > 0) {
      const window = rec.windows[0]!;
      newRecommendations.set(day, {
        hour: window.startHour,
        minute: window.startMinute,
      });
    } else {
      newRecommendations.set(day, null);
    }
  }

  // Analyze trends
  const trends = analyzeTrends(config.optimal_start_times, newRecommendations);

  // Blend times
  const changes: AdjustmentResult["changes"] = [];
  const updatedTimes: Partial<OptimalStartTimes> = {};

  const days: (keyof OptimalStartTimes)[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  for (const day of days) {
    const currentTime = config.optimal_start_times[day];
    const newRec = newRecommendations.get(day);
    const newTime = newRec ? formatTimeFromHourMinute(newRec.hour, newRec.minute) : null;

    const blendedTime = blendTimes(currentTime, newTime);

    // Only record as a change if actually different
    if (blendedTime !== currentTime) {
      changes.push({
        day,
        oldTime: currentTime,
        newTime,
        blendedTime,
      });
      updatedTimes[day] = blendedTime;
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
    reason:
      changes.length > 0
        ? `Adjusted ${changes.length} day(s) based on recent patterns`
        : "No significant changes detected",
    changes,
    trends,
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
      const newDisplay = change.blendedTime ?? "(none)";
      lines.push(`  ${dayName.padEnd(12)} ${oldDisplay} → ${newDisplay}`);
    }
  }

  lines.push("");
  lines.push("Trend Analysis:");
  lines.push(`  Pattern shift:    ${result.trends.direction}`);
  if (result.trends.shiftsDetected) {
    lines.push(`  Avg shift:        ${result.trends.avgShiftMinutes > 0 ? "+" : ""}${result.trends.avgShiftMinutes} minutes`);
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
