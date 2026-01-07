import { isInstalled, getDaysSinceInstall, isLearningComplete, markLearningComplete } from "../../config/state.ts";
import { loadConfig, updateConfig, type OptimalStartTimes } from "../../config/index.ts";
import { getHourlyUsageSince, setBaselineStat, getWindowsSince } from "../../db/queries.ts";
import { dbExists } from "../../db/client.ts";
import { toISO } from "../../utils/time.ts";
import {
  buildProfileFromRecords,
  findOptimalTrigger,
  minutesToTimeString,
  parseTimeToMinutes,
  countWaitEvents,
  calculateWastedQuota,
  type HourlyProfile,
} from "../../analyzer/trigger-optimizer.ts";

export async function analyze(args: string[]): Promise<void> {
  const shouldSave = args.includes("--save");
  const force = args.includes("--force");

  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
    return;
  }

  if (!dbExists()) {
    console.log("No data collected yet. Use Claude Code to start tracking.");
    return;
  }

  const config = loadConfig();
  const daysSinceInstall = getDaysSinceInstall();

  // Check if we have enough data
  if (daysSinceInstall < config.learning_period_days && !force) {
    const remaining = config.learning_period_days - daysSinceInstall;
    console.log(`Not enough data yet. ${remaining} days remaining in learning period.`);
    console.log();
    console.log("Use --force to analyze with available data anyway.");
    return;
  }

  console.log();

  // Get hourly usage from the past learning period
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.max(daysSinceInstall, 7));
  const hourlyRecords = getHourlyUsageSince(toISO(startDate));
  const windows = getWindowsSince(toISO(startDate));

  if (hourlyRecords.length === 0) {
    console.log("No usage data recorded yet.");
    console.log("Start using Claude Code and check back later.");
    return;
  }

  console.log(`Analyzing ${hourlyRecords.length} hourly records from ${daysSinceInstall} days of usage...`);
  console.log();

  // Build usage profile using TLA+ algorithm
  const profile = buildProfileFromRecords(hourlyRecords, windows);

  // Display profile summary
  console.log("Usage Profile (TLA+ Algorithm)");
  console.log("═".repeat(50));
  console.log("");
  displayProfileSummary(profile);
  console.log("");

  // Calculate and display metrics
  const waitEvents = countWaitEvents(hourlyRecords, windows);
  const wastedQuota = calculateWastedQuota(hourlyRecords, windows);

  console.log("Historical Metrics");
  console.log("─".repeat(50));
  console.log(`  Wait events:    ${waitEvents} (times quota exhausted before reset)`);
  console.log(`  Wasted quota:   ${wastedQuota.toFixed(0)}% total unused at resets`);
  console.log(`  Windows:        ${windows.length} tracked`);
  console.log("");

  // Run optimization for configured work days
  const { working_hours } = config;
  if (!working_hours.enabled || working_hours.work_days.length === 0) {
    console.log("No working hours configured. Run 'ccmax configure' first.");
    console.log("");
    return;
  }

  console.log("Optimal Start Times (TLA+ Optimization)");
  console.log("─".repeat(50));

  const optimalTimes: OptimalStartTimes = {
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: null,
    sunday: null,
  };

  for (const day of working_hours.work_days) {
    const dayHours = working_hours.hours[day];
    if (!dayHours) {
      console.log(`  ${capitalize(day).padEnd(12)} Not configured`);
      continue;
    }

    const workStartMins = parseTimeToMinutes(dayHours.start);
    const workEndMins = parseTimeToMinutes(dayHours.end);

    if (workEndMins <= workStartMins) {
      console.log(`  ${capitalize(day).padEnd(12)} Invalid hours`);
      continue;
    }

    // Run TLA+ optimization
    const result = findOptimalTrigger(profile, workStartMins, workEndMins);

    if (result.windows.length > 0) {
      const optimalTime = minutesToTimeString(result.windows[0]!.start);
      optimalTimes[day] = optimalTime;

      const validStr = result.isValid ? "" : " (fallback)";
      console.log(
        `  ${capitalize(day).padEnd(12)} ${optimalTime}  ` +
        `(${result.bucketCount} buckets, ${result.minSlack.toFixed(0)}% slack${validStr})`
      );
    } else {
      console.log(`  ${capitalize(day).padEnd(12)} No valid trigger found`);
    }
  }

  console.log("");

  // Calculate baseline stats if this is the first analysis
  if (!isLearningComplete()) {
    calculateAndSaveBaseline(hourlyRecords.length, daysSinceInstall, windows);
    markLearningComplete();
    console.log("─".repeat(50));
    console.log("Baseline statistics saved. Impact tracking is now active.");
    console.log("");
  }

  // Save recommendations if requested
  if (shouldSave) {
    updateConfig({ optimal_start_times: optimalTimes });
    console.log("Optimal start times saved to config.");
    console.log("");
  } else {
    console.log("To save these recommendations, run: ccmax analyze --save");
  }
}

function displayProfileSummary(profile: HourlyProfile): void {
  // Find active hours (non-zero usage)
  const activeHours: Array<{ hour: number; usage: number }> = [];
  for (let h = 0; h < 24; h++) {
    const usage = profile[h] ?? 0;
    if (usage > 0) {
      activeHours.push({ hour: h, usage });
    }
  }

  if (activeHours.length === 0) {
    console.log("  No usage data in profile");
    return;
  }

  // Sort by usage descending
  activeHours.sort((a, b) => b.usage - a.usage);

  console.log("  Hour   Avg Usage");
  console.log("  ─────  ─────────");

  // Show top 10 hours
  for (const { hour, usage } of activeHours.slice(0, 10)) {
    const bar = "█".repeat(Math.round(usage / 5));
    console.log(`  ${hour.toString().padStart(2, "0")}:00  ${usage.toFixed(1).padStart(5)}%  ${bar}`);
  }

  if (activeHours.length > 10) {
    console.log(`  ... and ${activeHours.length - 10} more hours`);
  }
}

function calculateAndSaveBaseline(
  recordCount: number,
  days: number,
  windows: Array<{ utilization_pct: number; active_minutes: number }>
): void {
  if (windows.length === 0) {
    return;
  }

  // Calculate baseline stats
  const avgWindowsPerDay = windows.length / Math.max(days, 1);
  const totalUtilization = windows.reduce((sum, w) => sum + w.utilization_pct, 0);
  const avgUtilization = totalUtilization / windows.length;
  const totalActiveMinutes = windows.reduce((sum, w) => sum + w.active_minutes, 0);
  const avgActiveMinutes = totalActiveMinutes / windows.length;
  const avgWastedMinutes = 300 - avgActiveMinutes;

  // Save baseline stats
  setBaselineStat("avg_windows_per_day", avgWindowsPerDay);
  setBaselineStat("avg_utilization", avgUtilization);
  setBaselineStat("avg_wasted_minutes_per_window", avgWastedMinutes);
  setBaselineStat("baseline_record_count", recordCount);
  setBaselineStat("baseline_days", days);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
