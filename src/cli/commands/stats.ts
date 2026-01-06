import { getWindowsInRange, getHourlyMaxUsageInRange, getOptimizedMetrics, getAllBaselineStats } from "../../db/queries.ts";
import { isInstalled, isLearningComplete } from "../../config/state.ts";
import { fromISO, formatTime, toISO, startOfDay, formatDate } from "../../utils/time.ts";
import { dbExists } from "../../db/client.ts";
import { isSyncConfigured } from "../../config/index.ts";
import { getAggregateWindows, getAggregateHourlyUsage } from "../../sync/gist.ts";

export async function stats(args: string[]): Promise<void> {
  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
    return;
  }

  if (!dbExists()) {
    console.log("No data collected yet. Use Claude Code to start tracking.");
    return;
  }

  const showLocal = args.includes("--local");
  const showAggregate = isSyncConfigured() && !showLocal;

  // Parse --days-ago flag (e.g., --days-ago 1 or --days-ago=1)
  let daysAgo = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--days-ago" && args[i + 1]) {
      daysAgo = parseInt(args[i + 1]!, 10);
      if (isNaN(daysAgo) || daysAgo < 0) daysAgo = 0;
    } else if (arg.startsWith("--days-ago=")) {
      daysAgo = parseInt(arg.slice(11), 10);
      if (isNaN(daysAgo) || daysAgo < 0) daysAgo = 0;
    }
  }

  console.log();

  // Calculate date range for the specified day
  const now = new Date();
  const targetDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const dayStart = startOfDay(targetDate);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Render the usage graph
  renderUsageGraph(dayStart, dayEnd, showAggregate, daysAgo);

  // Render window summary
  if (showAggregate) {
    renderAggregateWindowSummary(dayStart, dayEnd, daysAgo);
  } else {
    renderWindowSummary(dayStart, dayEnd, daysAgo);
  }

  // Render impact stats if optimization has started
  if (isLearningComplete()) {
    renderImpactStats();
  }

  console.log();
}

// ANSI color codes
const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
};

// Colors for alternating windows
const WINDOW_COLORS = [COLORS.cyan, COLORS.yellow, COLORS.magenta, COLORS.green, COLORS.blue];

function renderUsageGraph(dayStart: Date, dayEnd: Date, useAggregate: boolean, daysAgo: number): void {
  // Build title based on which day we're showing
  let title: string;
  if (daysAgo === 0) {
    title = "Usage today";
  } else if (daysAgo === 1) {
    title = "Usage yesterday";
  } else {
    title = `Usage ${formatDate(dayStart)}`;
  }
  console.log(title);
  console.log("═".repeat(62));
  console.log();

  const dayStartISO = toISO(dayStart);
  const dayEndISO = toISO(dayEnd);

  // Get windows for the target day only (for markers)
  // Use aggregate windows if available, otherwise local
  let windows: { window_start: string; window_end: string }[];
  if (useAggregate) {
    const aggregateWindows = getAggregateWindows();
    if (aggregateWindows && aggregateWindows.length > 0) {
      const filtered = aggregateWindows.filter((w) => w.window_start >= dayStartISO && w.window_start < dayEndISO);
      // Fall back to local if no aggregate windows for this day
      windows = filtered.length > 0 ? filtered : getWindowsInRange(dayStartISO, dayEndISO);
    } else {
      windows = getWindowsInRange(dayStartISO, dayEndISO);
    }
  } else {
    windows = getWindowsInRange(dayStartISO, dayEndISO);
  }

  // Get hourly max usage (aggregate from cache or local) for the target day
  let hourlyUsage: { hour: number; max_usage: number }[];
  if (useAggregate) {
    const aggregate = getAggregateHourlyUsage(dayStartISO);
    // Fall back to local if aggregate returns null or empty
    hourlyUsage = aggregate && aggregate.length > 0 ? aggregate : getHourlyMaxUsageInRange(dayStartISO, dayEndISO);
  } else {
    hourlyUsage = getHourlyMaxUsageInRange(dayStartISO, dayEndISO);
  }

  // Build hour to usage map
  const hourToUsage = new Map<number, number>();
  for (const hu of hourlyUsage) {
    hourToUsage.set(hu.hour, hu.max_usage);
  }

  // Build window start hours for markers and map hours to windows for coloring
  const windowStartHours = new Set<number>();
  const hourToWindowIndex = new Map<number, number>();
  windows.forEach((w, idx) => {
    const windowStart = fromISO(w.window_start);
    const windowEnd = fromISO(w.window_end);
    const startHour = windowStart.getHours();
    const endHour = windowEnd.getHours();

    windowStartHours.add(startHour);

    // Map all hours in this window to the window index
    if (endHour >= startHour) {
      for (let h = startHour; h <= endHour; h++) {
        hourToWindowIndex.set(h, idx);
      }
    } else {
      // Window spans midnight
      for (let h = startHour; h < 24; h++) {
        hourToWindowIndex.set(h, idx);
      }
      for (let h = 0; h <= endHour; h++) {
        hourToWindowIndex.set(h, idx);
      }
    }
  });

  // Render ASCII graph
  const graphHeight = 6;

  // Y-axis labels: 100%, 80%, 60%, 40%, 20%, 0%
  const yLabels = ["100%", " 80%", " 60%", " 40%", " 20%", "  0%"];
  // Row ranges: [lowerBound, upperBound] for each row
  // Labels represent the lower bound of each row, so bar at 36% appears below the 40% line
  const rowRanges: [number, number][] = [
    [100, 120], // Row 0 (100%): nothing typically renders here
    [80, 100],  // Row 1 (80%): 80-100%
    [60, 80],   // Row 2 (60%): 60-80%
    [40, 60],   // Row 3 (40%): 40-60%
    [20, 40],   // Row 4 (20%): 20-40%
    [0, 20],    // Row 5 (0%): 0-20%
  ];

  // Partial block characters from 1/8 to 8/8 height
  const BLOCKS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

  console.log("     ┌" + "─".repeat(48) + "┐");

  for (let row = 0; row < graphHeight; row++) {
    const [lowerBound, upperBound] = rowRanges[row]!;
    let line = yLabels[row] + " │";

    for (let hour = 0; hour < 24; hour++) {
      const usage = hourToUsage.get(hour) ?? 0;
      const windowIdx = hourToWindowIndex.get(hour);
      const color = windowIdx !== undefined ? (WINDOW_COLORS[windowIdx % WINDOW_COLORS.length] ?? COLORS.dim) : COLORS.dim;

      let block: string;
      if (usage <= 0 || usage < lowerBound) {
        // Usage doesn't reach this row
        block = " ";
      } else if (usage >= upperBound) {
        // Usage fully covers this row
        block = "█";
      } else {
        // Usage is within this row's range - show partial block
        const rangeSize = upperBound - lowerBound;
        const positionInRange = (usage - lowerBound) / rangeSize;
        const blockIndex = Math.ceil(positionInRange * 8);
        block = BLOCKS[Math.min(blockIndex, 8)]!;
      }

      if (block !== " ") {
        line += color + block + COLORS.reset + " ";
      } else {
        line += "  ";
      }
    }

    line += "│";
    console.log(line);
  }

  console.log("     └" + "─".repeat(48) + "┘");

  // X-axis labels (hours)
  let hourLabels = "      ";
  for (let h = 0; h < 24; h += 2) {
    hourLabels += h.toString().padStart(2, "0") + "  ";
  }
  console.log(hourLabels);

  // Window markers below x-axis
  if (windows.length > 0) {
    let windowMarkers = "      ";
    for (let h = 0; h < 24; h++) {
      if (windowStartHours.has(h)) {
        const windowIdx = hourToWindowIndex.get(h);
        const color = windowIdx !== undefined ? WINDOW_COLORS[windowIdx % WINDOW_COLORS.length] : COLORS.reset;
        windowMarkers += color + "▲" + COLORS.reset + " ";
      } else {
        windowMarkers += "  ";
      }
    }
    console.log(windowMarkers);
    console.log("      ▲ = 5h window start (colors show different windows)");
  }

  console.log();
}

function renderWindowSummary(start: Date, end: Date, daysAgo: number): void {
  const windows = getWindowsInRange(toISO(start), toISO(end));

  if (windows.length === 0) {
    const dayLabel = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `on ${formatDate(start)}`;
    console.log(`No windows recorded ${dayLabel}.`);
    return;
  }

  const headerLabel = daysAgo === 0 ? "(today)" : daysAgo === 1 ? "(yesterday)" : `(${formatDate(start)})`;
  console.log(`Windows ${headerLabel}:`);
  console.log("─".repeat(60));

  for (const window of windows) {
    const windowStart = fromISO(window.window_start);
    const windowEnd = fromISO(window.window_end);

    const startTime = formatTime(windowStart);
    const endTime = formatTime(windowEnd);

    const claudeUsage = window.claude_usage_pct || 0;

    const bar = createUsageBar(claudeUsage);
    const usageStr = claudeUsage > 0 ? `${claudeUsage.toFixed(0).padStart(3)}%` : "  -";

    console.log(`  ${startTime} - ${endTime}  ${bar} ${usageStr} used`);
  }

  // Calculate averages
  const windowsWithUsage = windows.filter((w) => w.claude_usage_pct > 0);
  const avgUsage =
    windowsWithUsage.length > 0
      ? windowsWithUsage.reduce((sum, w) => sum + w.claude_usage_pct, 0) / windowsWithUsage.length
      : 0;

  console.log("─".repeat(60));
  if (avgUsage > 0) {
    console.log(`  Average: ${avgUsage.toFixed(0)}% used`);
  }
  console.log();
}

function renderAggregateWindowSummary(start: Date, end: Date, daysAgo: number): void {
  const aggregateWindows = getAggregateWindows();

  if (!aggregateWindows || aggregateWindows.length === 0) {
    // Fall back to local data if aggregate fetch fails
    renderWindowSummary(start, end, daysAgo);
    return;
  }

  // Filter to windows in the time range
  const startISO = toISO(start);
  const endISO = toISO(end);
  const windows = aggregateWindows.filter((w) => w.window_start >= startISO && w.window_start < endISO);

  if (windows.length === 0) {
    // Fall back to local data if no aggregate windows for this day
    renderWindowSummary(start, end, daysAgo);
    return;
  }

  const headerLabel = daysAgo === 0 ? "(today)" : daysAgo === 1 ? "(yesterday)" : `(${formatDate(start)})`;
  console.log(`Windows ${headerLabel} ${COLORS.cyan}[all machines]${COLORS.reset}:`);
  console.log("─".repeat(60));

  for (const window of windows) {
    const windowStart = fromISO(window.window_start);
    const windowEnd = fromISO(window.window_end);

    const startTime = formatTime(windowStart);
    const endTime = formatTime(windowEnd);

    const claudeUsage = window.claude_usage_pct || 0;

    const bar = createUsageBar(claudeUsage);
    const usageStr = claudeUsage > 0 ? `${claudeUsage.toFixed(0).padStart(3)}%` : "  -";

    console.log(`  ${startTime} - ${endTime}  ${bar} ${usageStr} used`);
  }

  // Calculate averages
  const windowsWithUsage = windows.filter((w) => w.claude_usage_pct > 0);
  const avgUsage =
    windowsWithUsage.length > 0
      ? windowsWithUsage.reduce((sum, w) => sum + w.claude_usage_pct, 0) / windowsWithUsage.length
      : 0;

  console.log("─".repeat(60));
  if (avgUsage > 0) {
    console.log(`  Average: ${avgUsage.toFixed(0)}% used`);
  }
  console.log();
}

function renderImpactStats(): void {
  const metrics = getOptimizedMetrics();
  const baseline = getAllBaselineStats();

  if (metrics.length === 0 || Object.keys(baseline).length === 0) {
    return;
  }

  // Calculate impact
  let totalWindowsAvoided = 0;
  let totalUtilization = 0;

  for (const m of metrics) {
    totalWindowsAvoided += Math.max(0, m.windows_predicted - m.windows_used);
    totalUtilization += m.avg_utilization;
  }

  const avgUtilizationAfter = totalUtilization / metrics.length;
  const avgUtilizationBefore = baseline["avg_utilization"] ?? 0;
  const utilizationImprovement = avgUtilizationAfter - avgUtilizationBefore;
  const hoursSaved = totalWindowsAvoided * 5;

  // Calculate wasted time saved
  const baselineWasted = baseline["avg_wasted_minutes_per_window"] ?? 0;
  const currentAvgActive =
    metrics.reduce((sum, m) => sum + m.avg_utilization * 3, 0) / metrics.length; // approx active minutes
  const currentWasted = 300 - currentAvgActive;
  const wastedTimeSaved =
    ((baselineWasted - currentWasted) * metrics.length) / 60;

  console.log("─".repeat(62));
  console.log(" ccmax impact (since optimization started)");
  console.log("─".repeat(62));
  console.log(
    ` Windows avoided:     ${totalWindowsAvoided} (saved ~${hoursSaved}h of limit time)`
  );
  console.log(
    ` Avg utilization:     ${avgUtilizationBefore.toFixed(0)}% → ${avgUtilizationAfter.toFixed(0)}% (${utilizationImprovement >= 0 ? "+" : ""}${utilizationImprovement.toFixed(0)}%)`
  );
  if (wastedTimeSaved > 0) {
    console.log(` Wasted time saved:   ~${wastedTimeSaved.toFixed(1)}h`);
  }
}

/**
 * Creates a bar showing Claude quota usage.
 * - █ = quota used
 * - ▓ = quota remaining
 */
function createUsageBar(claudeUsage: number): string {
  const width = 10;

  const usedBlocks = Math.round((claudeUsage / 100) * width);
  const remainingBlocks = width - usedBlocks;

  const used = COLORS.cyan + "█".repeat(usedBlocks) + COLORS.reset;
  const remaining = COLORS.dim + "▓".repeat(remainingBlocks) + COLORS.reset;

  return used + remaining;
}
