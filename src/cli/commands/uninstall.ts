import * as readline from "readline";
import { uninstallHook, isHookInstalled } from "../../hook/install.ts";
import { isInstalled } from "../../config/state.ts";
import { DATA_DIR, INSTALLED_BINARY_PATH } from "../../utils/paths.ts";
import { rmSync, existsSync, unlinkSync } from "fs";
import { closeDb } from "../../db/client.ts";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function uninstall(args: string[]): Promise<void> {
  const purge = args.includes("--purge");
  const force = args.includes("--force") || args.includes("-f");
  const dryRun = args.includes("--dry-run");

  if (!isInstalled() && !isHookInstalled()) {
    console.log("ccmax is not installed.");
    return;
  }

  if (dryRun) {
    console.log("[DRY RUN] Would perform the following actions:");
    console.log("  - Remove Claude Code hooks");
    console.log(`  - Remove binary at ${INSTALLED_BINARY_PATH}`);
    if (purge) {
      console.log(`  - Delete all data in ${DATA_DIR}`);
    }
    return;
  }

  // Confirm if purging and not forced
  if (purge && !force) {
    console.log("WARNING: This will delete all usage data and statistics.");
    const answer = await prompt("Are you sure? (yes/no): ");
    if (answer !== "yes" && answer !== "y") {
      console.log("Cancelled.");
      return;
    }
  }

  // Remove hook
  process.stdout.write("Removing Claude Code hook... ");
  const hookResult = uninstallHook();
  if (!hookResult.success) {
    console.log("✗");
    console.error(`Error: ${hookResult.error}`);
  } else {
    console.log("✓");
  }

  // Remove installed binary
  process.stdout.write("Removing binary... ");
  if (existsSync(INSTALLED_BINARY_PATH)) {
    try {
      unlinkSync(INSTALLED_BINARY_PATH);
      console.log("✓");
    } catch (err) {
      console.log("✗");
      console.error(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  } else {
    console.log("✓ (not found)");
  }

  // Purge data if requested
  if (purge) {
    process.stdout.write("Deleting usage data... ");

    // Close database connection first
    closeDb();

    if (existsSync(DATA_DIR)) {
      try {
        rmSync(DATA_DIR, { recursive: true, force: true });
        console.log("✓");
      } catch (err) {
        console.log("✗");
        console.error(`Error deleting data: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    } else {
      console.log("✓ (nothing to delete)");
    }
  }

  console.log();
  console.log("ccmax has been uninstalled.");

  if (!purge) {
    console.log();
    console.log("Note: Your usage data has been preserved.");
    console.log(`To delete all data, run: ccmax uninstall --purge`);
    console.log(`Data location: ${DATA_DIR}`);
  }
}
