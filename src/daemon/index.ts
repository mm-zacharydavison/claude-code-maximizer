import { runSchedulerTick } from "./scheduler.ts";
import { setDaemonPid } from "../config/state.ts";
import { shouldRunAdjustment, runAdaptiveAdjustment } from "../analyzer/adaptive.ts";
import { isLearningComplete } from "../config/state.ts";
import { isSyncConfigured } from "../config/index.ts";
import { pushToGist } from "../sync/gist.ts";

const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
const ADJUSTMENT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check for adjustment every hour
const SYNC_INTERVAL_MS = 15 * 60 * 1000; // Sync every 15 minutes

let intervalId: ReturnType<typeof setInterval> | null = null;
let adjustmentIntervalId: ReturnType<typeof setInterval> | null = null;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Checks and runs adaptive adjustment if needed
 */
function checkAndRunAdjustment(): void {
  // Only run after learning period is complete
  if (!isLearningComplete()) {
    return;
  }

  if (shouldRunAdjustment()) {
    console.log(`[${new Date().toISOString()}] Running adaptive adjustment...`);
    const result = runAdaptiveAdjustment();
    if (result.adjusted) {
      console.log(`Adjusted ${result.changes.length} day(s)`);
    }
  }
}

/**
 * Syncs data to GitHub Gist if configured
 */
async function checkAndSync(): Promise<void> {
  if (!isSyncConfigured()) {
    return;
  }

  console.log(`[${new Date().toISOString()}] Syncing to GitHub Gist...`);
  const result = await pushToGist();
  if (result.success) {
    console.log(`Sync complete: ${result.message}`);
  } else {
    console.error(`Sync failed: ${result.message}`);
  }
}

export function startDaemon(): void {
  console.log(`ccmax daemon starting (PID: ${process.pid})`);

  // Save PID to state
  setDaemonPid(process.pid);

  // Initial scheduler tick (handles both on-time and late window triggers)
  runSchedulerTick();

  // Check for adaptive adjustment on startup
  try {
    checkAndRunAdjustment();
  } catch (err) {
    console.error("Error in initial adjustment check:", err);
  }

  // Set up scheduler interval (runs every minute)
  intervalId = setInterval(() => {
    try {
      runSchedulerTick();
    } catch (err) {
      console.error("Error in scheduler tick:", err);
    }
  }, CHECK_INTERVAL_MS);

  // Set up adjustment check interval (hourly)
  adjustmentIntervalId = setInterval(() => {
    try {
      checkAndRunAdjustment();
    } catch (err) {
      console.error("Error in adjustment check:", err);
    }
  }, ADJUSTMENT_CHECK_INTERVAL_MS);

  // Set up sync interval (every 15 minutes) if configured
  if (isSyncConfigured()) {
    console.log("Sync is configured - will sync every 15 minutes");
    // Initial sync
    checkAndSync().catch((err) => console.error("Error in initial sync:", err));

    syncIntervalId = setInterval(() => {
      checkAndSync().catch((err) => console.error("Error in sync:", err));
    }, SYNC_INTERVAL_MS);
  }

  // Handle graceful shutdown
  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

  console.log("ccmax daemon running. Press Ctrl+C to stop.");
}

function handleShutdown(): void {
  console.log("\nShutting down ccmax daemon...");

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (adjustmentIntervalId) {
    clearInterval(adjustmentIntervalId);
    adjustmentIntervalId = null;
  }

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }

  // Clear PID from state
  setDaemonPid(null);

  process.exit(0);
}

export function isDaemonRunning(pid: number | null): boolean {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
