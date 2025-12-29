import type { DailyUsage } from "./aggregator.ts";
import { calculateDayRecommendation, formatTimeFromHourMinute, type DayRecommendation } from "./optimizer.ts";

export interface WeeklyPattern {
  recommendations: Map<string, DayRecommendation>;
  mostActiveDay: string;
  leastActiveDay: string;
  averageDailyHours: number;
  peakHour: number;
}

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export function analyzeWeeklyPatterns(
  weekdayData: Map<string, DailyUsage[]>
): WeeklyPattern {
  const recommendations = new Map<string, DayRecommendation>();

  let totalHours = 0;
  let totalDays = 0;
  let mostActiveHours = 0;
  let mostActiveDay = "monday";
  let leastActiveHours = Infinity;
  let leastActiveDay = "monday";

  for (const day of WEEKDAYS) {
    const dayData = weekdayData.get(day) ?? [];
    const recommendation = calculateDayRecommendation(day, dayData);
    recommendations.set(day, recommendation);

    if (dayData.length > 0) {
      const avgHours = recommendation.totalExpectedHours;
      totalHours += avgHours;
      totalDays++;

      if (avgHours > mostActiveHours) {
        mostActiveHours = avgHours;
        mostActiveDay = day;
      }

      if (avgHours < leastActiveHours) {
        leastActiveHours = avgHours;
        leastActiveDay = day;
      }
    }
  }

  // Find peak hour across all data
  const hourCounts = new Array(24).fill(0) as number[];
  for (const dayData of weekdayData.values()) {
    for (const usage of dayData) {
      for (const h of usage.hours) {
        hourCounts[h.hour] = (hourCounts[h.hour] ?? 0) + 1;
      }
    }
  }

  let peakHour = 0;
  let peakCount = 0;
  for (let h = 0; h < 24; h++) {
    if ((hourCounts[h] ?? 0) > peakCount) {
      peakCount = hourCounts[h] ?? 0;
      peakHour = h;
    }
  }

  return {
    recommendations,
    mostActiveDay,
    leastActiveDay,
    averageDailyHours: totalDays > 0 ? totalHours / totalDays : 0,
    peakHour,
  };
}

export function formatPatternSummary(pattern: WeeklyPattern): string {
  const lines: string[] = [];

  lines.push("Weekly Usage Patterns");
  lines.push("═".repeat(50));
  lines.push("");

  // Summary stats
  lines.push(`Average daily activity: ${pattern.averageDailyHours.toFixed(1)} hours`);
  lines.push(`Peak activity hour:     ${pattern.peakHour}:00`);
  lines.push(`Most active day:        ${capitalize(pattern.mostActiveDay)}`);
  lines.push(`Least active day:       ${capitalize(pattern.leastActiveDay)}`);
  lines.push("");

  // Per-day recommendations
  lines.push("Recommended Start Times");
  lines.push("─".repeat(50));

  for (const day of WEEKDAYS) {
    const rec = pattern.recommendations.get(day);
    if (!rec || rec.windows.length === 0) {
      lines.push(`  ${capitalize(day).padEnd(12)} No data`);
      continue;
    }

    const window = rec.windows[0]!;
    const time = formatTimeFromHourMinute(window.startHour, window.startMinute);
    const confidence = Math.round(window.confidence * 100);
    const utilization = Math.round(window.expectedUtilization);

    lines.push(
      `  ${capitalize(day).padEnd(12)} ${time}  (${confidence}% confidence, ~${utilization}% avg usage)`
    );
  }

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
