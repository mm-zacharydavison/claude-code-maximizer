import type { DailyUsage } from "./aggregator.ts";

export interface OptimalWindow {
  startHour: number;
  startMinute: number;
  confidence: number; // 0-1
  expectedUtilization: number; // 0-100
  dataPoints: number;
}

export interface DayRecommendation {
  day: string;
  windows: OptimalWindow[];
  totalExpectedHours: number;
  avgUsage: number;
}

/**
 * Calculate optimal start time based on hourly usage patterns
 */
export function calculateOptimalStartTime(
  usageData: DailyUsage[]
): OptimalWindow | null {
  if (usageData.length === 0) {
    return null;
  }

  // Collect all active hours across all days
  const hourCounts = new Array(24).fill(0) as number[];
  const hourUsage = new Array(24).fill(0) as number[];
  let totalDataPoints = 0;

  for (const usage of usageData) {
    for (const h of usage.hours) {
      hourCounts[h.hour] = (hourCounts[h.hour] ?? 0) + 1;
      hourUsage[h.hour] = (hourUsage[h.hour] ?? 0) + h.usagePct;
      totalDataPoints++;
    }
  }

  if (totalDataPoints === 0) {
    return null;
  }

  // Find the hour with most activity
  let peakHour = 9; // default
  let peakCount = 0;
  for (let h = 0; h < 24; h++) {
    if ((hourCounts[h] ?? 0) > peakCount) {
      peakCount = hourCounts[h] ?? 0;
      peakHour = h;
    }
  }

  // Find the earliest active hour (within 3 hours before peak)
  let startHour = peakHour;
  for (let h = peakHour - 3; h < peakHour; h++) {
    const hour = (h + 24) % 24;
    if ((hourCounts[hour] ?? 0) > 0) {
      startHour = hour;
      break;
    }
  }

  // Recommend starting 15 minutes before typical activity
  let optimalHour = startHour;
  let optimalMinute = 45; // :45 of previous hour

  if (optimalMinute >= 60) {
    optimalMinute = 0;
  } else {
    optimalHour = (optimalHour - 1 + 24) % 24;
  }

  // Calculate average usage during active hours
  const avgUsage =
    hourUsage.reduce((a, b) => a + b, 0) / Math.max(1, hourCounts.filter(c => c > 0).length);

  // Calculate confidence based on consistency of data
  const activeDays = usageData.filter(u => u.hours.length > 0).length;
  const confidence = Math.min(1, activeDays / 5); // Need ~5 days of data for full confidence

  return {
    startHour: optimalHour,
    startMinute: optimalMinute,
    confidence,
    expectedUtilization: Math.min(100, avgUsage),
    dataPoints: totalDataPoints,
  };
}

export function calculateDayRecommendation(
  day: string,
  usageData: DailyUsage[]
): DayRecommendation {
  if (usageData.length === 0) {
    return {
      day,
      windows: [],
      totalExpectedHours: 0,
      avgUsage: 0,
    };
  }

  // Calculate averages
  const totalActiveHours = usageData.reduce((sum, u) => sum + u.totalActiveHours, 0);
  const avgActiveHours = totalActiveHours / usageData.length;
  const avgUsage = usageData.reduce((sum, u) => sum + u.avgUsage, 0) / usageData.length;

  // Get optimal start time
  const optimalWindow = calculateOptimalStartTime(usageData);

  return {
    day,
    windows: optimalWindow ? [optimalWindow] : [],
    totalExpectedHours: avgActiveHours,
    avgUsage,
  };
}

export function formatTimeFromHourMinute(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}
