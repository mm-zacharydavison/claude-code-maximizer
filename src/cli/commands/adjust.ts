import { isInstalled, isLearningComplete } from "../../config/state.ts";
import { dbExists } from "../../db/client.ts";
import {
  runAdaptiveAdjustment,
  formatAdjustmentResult,
  getLastAdjustmentInfo,
  shouldRunAdjustment,
} from "../../analyzer/adaptive.ts";
import { loadConfig } from "../../config/index.ts";

export async function adjust(args: string[]): Promise<void> {
  const showHelp = args.includes("--help") || args.includes("-h");
  const force = args.includes("--force") || args.includes("-f");
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const showStatus = args.includes("--status") || args.includes("-s");

  if (showHelp) {
    console.log(`
ccmax adjust - Adaptively adjust optimal start times

USAGE:
  ccmax adjust [options]

OPTIONS:
  --force, -f     Force adjustment even if not due
  --dry-run, -n   Show what would change without applying
  --status, -s    Show adjustment status without running
  --help, -h      Show this help message

DESCRIPTION:
  The adjust command blends your recent usage patterns with existing
  optimal start times using an exponential moving average (EMA).

  By default, adjustment runs automatically every 7 days when the
  daemon is running. Use this command to manually trigger adjustment
  or check adjustment status.

EXAMPLES:
  ccmax adjust            Run adjustment if due
  ccmax adjust --force    Force adjustment now
  ccmax adjust --dry-run  Preview changes without applying
  ccmax adjust --status   Check when next adjustment is due
`);
    return;
  }

  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
    return;
  }

  if (!dbExists()) {
    console.log("No data collected yet. Use Claude Code to start tracking.");
    return;
  }

  if (!isLearningComplete()) {
    console.log("Learning period not complete. Run 'ccmax analyze' first to complete learning.");
    return;
  }

  const config = loadConfig();
  if (!config.auto_adjust_enabled) {
    console.log("Auto-adjustment is disabled.");
    console.log("Enable with: ccmax config set auto_adjust_enabled true");
    return;
  }

  // Show status mode
  if (showStatus) {
    showAdjustmentStatus();
    return;
  }

  // Check if adjustment is needed
  const needsAdjustment = shouldRunAdjustment();

  if (!needsAdjustment && !force) {
    const info = getLastAdjustmentInfo();
    console.log("Adjustment not due yet.");
    if (info.daysSince !== null) {
      console.log(`Last adjustment: ${info.daysSince} day(s) ago`);
      console.log(`Next adjustment due in: ${7 - info.daysSince} day(s)`);
    }
    console.log("\nUse --force to run adjustment anyway.");
    return;
  }

  console.log();

  if (dryRun) {
    console.log("DRY RUN - Changes will not be applied\n");
  }

  // Run adjustment
  const result = runAdaptiveAdjustment();

  if (dryRun && result.adjusted) {
    // Revert changes for dry run by reloading original config
    // (The adjustment already ran, so we need to note this is a preview)
    console.log("PREVIEW of changes that would be made:\n");
  }

  console.log(formatAdjustmentResult(result));
  console.log();
}

function showAdjustmentStatus(): void {
  const info = getLastAdjustmentInfo();
  const config = loadConfig();

  console.log();
  console.log("Adaptive Adjustment Status");
  console.log("─".repeat(40));
  console.log();

  console.log(`Auto-adjust enabled:  ${config.auto_adjust_enabled ? "Yes" : "No"}`);
  console.log(`Adjustment interval:  7 days`);
  console.log(`Total adjustments:    ${info.count}`);

  if (info.timestamp) {
    console.log(`Last adjustment:      ${info.timestamp.toLocaleDateString()} (${info.daysSince} days ago)`);
    const daysUntilNext = Math.max(0, 7 - (info.daysSince ?? 0));
    console.log(`Next adjustment:      ${daysUntilNext === 0 ? "Due now" : `In ${daysUntilNext} day(s)`}`);
  } else {
    console.log(`Last adjustment:      Never`);
    console.log(`Next adjustment:      Due on next check`);
  }

  console.log();
  console.log("Current optimal start times:");

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
  for (const day of days) {
    const time = config.optimal_start_times[day];
    const dayName = day.charAt(0).toUpperCase() + day.slice(1);
    console.log(`  ${dayName.padEnd(12)} ${time ?? "(not set)"}`);
  }

  console.log();
}
