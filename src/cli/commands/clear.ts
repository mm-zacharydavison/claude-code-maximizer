import { getDb, dbExists } from "../../db/client.ts";
import { getHourlyUsageCount, getWindowCount } from "../../db/queries.ts";
import { DATA_DIR } from "../../utils/paths.ts";
import { setCurrentWindowStart, setCurrentWindowEnd } from "../../config/state.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";

export async function clear(args: string[]): Promise<void> {
  const clearAll = args.includes("--all");
  const force = args.includes("--force");

  if (!dbExists()) {
    console.log("No data to clear.");
    return;
  }

  // Show what will be deleted
  const hourlyCount = getHourlyUsageCount();
  const windowCount = getWindowCount();

  console.log("\nThis will delete:");
  console.log(`  • ${hourlyCount} hourly usage records`);
  console.log(`  • ${windowCount} usage windows`);
  if (clearAll) {
    console.log("  • All config and state files");
  }
  console.log();

  // Ask for confirmation unless --force
  if (!force) {
    process.stdout.write("Are you sure? [y/N] ");

    const response = await new Promise<string>((resolve) => {
      let data = "";
      process.stdin.setRawMode?.(false);
      process.stdin.resume();
      process.stdin.once("data", (chunk) => {
        data = chunk.toString().trim().toLowerCase();
        process.stdin.pause();
        resolve(data);
      });
    });

    if (response !== "y" && response !== "yes") {
      console.log("Cancelled.");
      return;
    }
  }

  // Clear the database
  const db = getDb();
  db.run("DELETE FROM hourly_usage");
  db.run("DELETE FROM usage_windows");
  db.run("DELETE FROM impact_metrics");
  db.run("DELETE FROM baseline_stats");

  // Reset window state
  setCurrentWindowStart(null);
  setCurrentWindowEnd(null);

  console.log("✓ Cleared database");

  // Clear config/state if --all
  if (clearAll) {
    try {
      await rm(join(DATA_DIR, "config.json"), { force: true });
      await rm(join(DATA_DIR, "state.json"), { force: true });
      await rm(join(DATA_DIR, "usage-cache.json"), { force: true });
      console.log("✓ Cleared config and state");
    } catch {
      // Ignore errors
    }
  }

  console.log("\nData cleared successfully.");
}
