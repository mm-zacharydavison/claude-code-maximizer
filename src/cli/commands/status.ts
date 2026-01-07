import { isHookInstalled } from "../../hook/install.ts";
import { loadConfig, DAY_LABELS, type DayOfWeek } from "../../config/index.ts";
import { loadState, isInstalled, getDaysSinceInstall } from "../../config/state.ts";
import { getHourlyUsageCount, getWindowCount, getCurrentWindow } from "../../db/queries.ts";
import { dbExists } from "../../db/client.ts";
import { fromISO, formatTime, getWindowEnd } from "../../utils/time.ts";
import { getCachedUsage, formatUsage } from "../../usage/index.ts";

function formatDayListShort(days: DayOfWeek[]): string {
  if (days.length === 0) return "None";
  if (days.length === 7) return "Every day";
  if (
    days.length === 5 &&
    days.includes("monday") &&
    days.includes("tuesday") &&
    days.includes("wednesday") &&
    days.includes("thursday") &&
    days.includes("friday") &&
    !days.includes("saturday") &&
    !days.includes("sunday")
  ) {
    return "Mon-Fri";
  }
  return days.map((d) => DAY_LABELS[d].slice(0, 3)).join(", ");
}

export async function status(_args: string[]): Promise<void> {
  console.log();
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║          ccmax Status                         ║");
  console.log("╚═══════════════════════════════════════════════╝");
  console.log();

  // Installation status
  const installed = isInstalled();
  const hookInstalled = isHookInstalled();

  console.log("Installation:");
  console.log(`  Installed:      ${installed ? "✓ Yes" : "✗ No"}`);
  console.log(`  Hook active:    ${hookInstalled ? "✓ Yes" : "✗ No"}`);

  if (!installed) {
    console.log();
    console.log("Run 'ccmax install' to set up tracking.");
    return;
  }

  // Config info
  const config = loadConfig();
  const state = loadState();

  console.log();
  console.log("Configuration:");
  console.log(`  Learning period:  ${config.learning_period_days} days`);
  console.log(`  Auto-adjust:      ${config.auto_adjust_enabled ? "Enabled" : "Disabled"}`);
  console.log(`  Notifications:    ${config.notifications_enabled ? "Enabled" : "Disabled"}`);

  // Working hours configuration
  const { working_hours } = config;
  if (working_hours.enabled) {
    console.log();
    console.log("Working Hours:");
    console.log(`  Work days:        ${formatDayListShort(working_hours.work_days)}`);

    // Show sample hours (first work day's hours)
    const firstDay = working_hours.work_days[0];
    const sampleHours = firstDay ? working_hours.hours[firstDay] : null;
    if (sampleHours) {
      // Check if all days have same hours
      const allSame = working_hours.work_days.every((d) => {
        const h = working_hours.hours[d];
        return h?.start === sampleHours.start && h?.end === sampleHours.end;
      });

      if (allSame) {
        console.log(`  Hours:            ${sampleHours.start} - ${sampleHours.end}`);
      } else {
        console.log(`  Hours:            (varies by day - run 'ccmax configure show')`);
      }
    }
    console.log(`  Usage blending:   ${working_hours.auto_adjust_from_usage ? "Enabled" : "Disabled"}`);
  }

  // Learning progress
  const daysSinceInstall = getDaysSinceInstall();
  const learningComplete = state.learning_complete || daysSinceInstall >= config.learning_period_days;
  const daysRemaining = Math.max(0, config.learning_period_days - daysSinceInstall);

  console.log();
  console.log("Learning Progress:");

  if (learningComplete) {
    console.log("  Status:           ✓ Complete");
    console.log(`  Days tracked:     ${daysSinceInstall}`);
  } else {
    const progress = Math.min(100, Math.round((daysSinceInstall / config.learning_period_days) * 100));
    const progressBar = createProgressBar(progress, 20);
    console.log(`  Status:           Learning (${daysRemaining} days remaining)`);
    console.log(`  Progress:         ${progressBar} ${progress}%`);
    console.log(`  Days tracked:     ${daysSinceInstall} / ${config.learning_period_days}`);
  }

  // Data stats
  if (dbExists()) {
    console.log();
    console.log("Data Collection:");

    const hourlyCount = getHourlyUsageCount();
    const windowCount = getWindowCount();

    console.log(`  Hourly records:   ${hourlyCount}`);
    console.log(`  Windows tracked:  ${windowCount}`);

    // Current window info
    const currentWindow = getCurrentWindow();
    if (currentWindow) {
      const windowStart = fromISO(currentWindow.window_start);
      const windowEnd = getWindowEnd(windowStart);

      console.log();
      console.log("Current Window:");
      console.log(`  Started:          ${formatTime(windowStart)}`);
      console.log(`  Ends:             ${formatTime(windowEnd)}`);
      console.log(`  Active time:      ${currentWindow.active_minutes} min`);
      console.log(`  Utilization:      ${currentWindow.utilization_pct.toFixed(1)}%`);
    }
  }

  // Daemon status
  if (state.daemon_pid) {
    const isRunning = checkProcessRunning(state.daemon_pid);
    console.log();
    console.log("Daemon:");
    console.log(`  Status:           ${isRunning ? "✓ Running" : "✗ Not running"}`);
    if (isRunning) {
      console.log(`  PID:              ${state.daemon_pid}`);
    }
  }

  // Claude usage (from cache)
  const usage = getCachedUsage();
  if (usage) {
    console.log();
    console.log("Claude Rate Limits:");
    console.log(formatUsage(usage));
  }

  console.log();

  // Suggestions
  if (!learningComplete) {
    console.log("Tip: Keep using Claude Code normally. After the learning period,");
    console.log("     run 'ccmax analyze' to see your usage patterns.");
  } else if (!state.daemon_pid) {
    console.log("Tip: Run 'ccmax analyze' to see recommendations, then");
    console.log("     'ccmax daemon start' to enable automatic notifications.");
  }

  console.log();
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
}

function checkProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
