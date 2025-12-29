import { isInstalled, getDaysSinceInstall, isLearningComplete, markLearningComplete } from "../../config/state.ts";
import { loadConfig, updateConfig, type OptimalStartTimes } from "../../config/index.ts";
import { getHourlyUsageSince, setBaselineStat, getWindowsSince } from "../../db/queries.ts";
import { dbExists } from "../../db/client.ts";
import { aggregateByDay, getWeekdayDistribution } from "../../analyzer/aggregator.ts";
import { analyzeWeeklyPatterns, formatPatternSummary } from "../../analyzer/patterns.ts";
import { formatTimeFromHourMinute } from "../../analyzer/optimizer.ts";
import { toISO } from "../../utils/time.ts";

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

  if (hourlyRecords.length === 0) {
    console.log("No usage data recorded yet.");
    console.log("Start using Claude Code and check back later.");
    return;
  }

  console.log(`Analyzing ${hourlyRecords.length} hourly records from ${daysSinceInstall} days of usage...`);
  console.log();

  // Aggregate and analyze
  const dailyUsage = aggregateByDay(hourlyRecords);
  const weekdayData = getWeekdayDistribution(dailyUsage);
  const patterns = analyzeWeeklyPatterns(weekdayData);

  // Display patterns
  console.log(formatPatternSummary(patterns));
  console.log();

  // Calculate baseline stats if this is the first analysis
  if (!isLearningComplete()) {
    calculateAndSaveBaseline(hourlyRecords.length, daysSinceInstall);
    markLearningComplete();
    console.log("─".repeat(50));
    console.log("Baseline statistics saved. Impact tracking is now active.");
    console.log();
  }

  // Save recommendations if requested
  if (shouldSave) {
    const optimalTimes: Partial<OptimalStartTimes> = {};

    for (const [day, rec] of patterns.recommendations) {
      if (rec.windows.length > 0) {
        const window = rec.windows[0]!;
        optimalTimes[day as keyof OptimalStartTimes] = formatTimeFromHourMinute(
          window.startHour,
          window.startMinute
        );
      }
    }

    updateConfig({ optimal_start_times: { ...config.optimal_start_times, ...optimalTimes } });
    console.log("Optimal start times saved to config.");
    console.log();
  } else {
    console.log("To save these recommendations, run: ccmax analyze --save");
  }
}

function calculateAndSaveBaseline(recordCount: number, days: number): void {
  // Get window data for baseline
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const windows = getWindowsSince(toISO(startDate));

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
