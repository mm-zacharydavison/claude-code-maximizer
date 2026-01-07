import * as readline from "readline";
import { execSync } from "child_process";
import { installHook } from "../../hook/install.ts";
import { loadConfig, saveConfig, isSyncConfigured, isWorkingHoursConfigured } from "../../config/index.ts";
import { setupSync } from "../../sync/gist.ts";
import { markInstalled, isInstalled } from "../../config/state.ts";
import { getDb } from "../../db/client.ts";
import { DATA_DIR, BIN_DIR, INSTALLED_BINARY_PATH } from "../../utils/paths.ts";
import { mkdirSync, existsSync, copyFileSync, chmodSync } from "fs";
import { dirname } from "path";
import { installService, startService, enableService, getServiceTypeName } from "../../daemon/service.ts";
import { isPlatformSupported } from "../../utils/platform.ts";
import { configure } from "./configure.ts";

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function findSourceDir(): string | null {
  // Try to find the source directory for building
  const possiblePaths = [
    process.cwd(),
    dirname(process.argv[1] ?? ""),
    dirname(dirname(process.argv[1] ?? "")),
  ];

  for (const p of possiblePaths) {
    if (existsSync(`${p}/src/cli/index.ts`) && existsSync(`${p}/package.json`)) {
      return p;
    }
  }

  return null;
}

function buildAndInstallBinary(quiet: boolean): { success: boolean; error?: string } {
  try {
    // Ensure bin directory exists
    if (!existsSync(BIN_DIR)) {
      mkdirSync(BIN_DIR, { recursive: true });
    }

    // process.execPath for a compiled bun binary is the binary itself
    const realExecutable = process.execPath;

    // Check if we're running from a compiled ccmax binary
    // When compiled, process.execPath points to the actual binary, not to bun
    const isCompiledBinary = realExecutable.endsWith("/ccmax") ||
                              realExecutable.endsWith("/ccmax.exe") ||
                              (existsSync(realExecutable) && !realExecutable.includes("/bun"));

    if (isCompiledBinary && existsSync(realExecutable)) {
      if (realExecutable !== INSTALLED_BINARY_PATH) {
        copyFileSync(realExecutable, INSTALLED_BINARY_PATH);
        chmodSync(INSTALLED_BINARY_PATH, 0o755);
      }
      return { success: true };
    }

    // Try to find source and build
    const sourceDir = findSourceDir();
    if (sourceDir) {
      execSync(`bun build ${sourceDir}/src/cli/index.ts --compile --outfile ${INSTALLED_BINARY_PATH}`, {
        stdio: quiet ? "ignore" : "inherit",
      });
      chmodSync(INSTALLED_BINARY_PATH, 0o755);
      return { success: true };
    }

    // If we can't find source, try to use bunx to get the package
    return {
      success: false,
      error: "Could not find source directory to build binary. Please run from the project directory.",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function install(args: string[]): Promise<void> {
  const isQuiet = args.includes("--quiet") || args.includes("-q");
  const skipOnboarding = args.includes("--skip-onboarding");

  // Check if this is a reinstall (state exists with installed_at set)
  const isReinstall = isInstalled();

  if (!isQuiet) {
    if (isReinstall) {
      console.log("Reinstalling ccmax (preserving existing data)...");
      console.log();
    } else {
      console.log("╔═══════════════════════════════════════════════╗");
      console.log("║     Welcome to Claude Code Maximizer!         ║");
      console.log("╚═══════════════════════════════════════════════╝");
      console.log();
      console.log("This tool will help you optimize your Claude Code Max");
      console.log("5-hour rolling windows for maximum productivity.");
    }
  }

  // Learning period defaults to 7 days for auto-detection mode
  const learningPeriod = 7;

  // Build and install binary
  if (!isQuiet) {
    process.stdout.write("\nBuilding and installing binary... ");
  }
  const buildResult = buildAndInstallBinary(isQuiet);
  if (!buildResult.success) {
    if (!isQuiet) console.log("✗");
    console.error(`\nError building binary: ${buildResult.error}`);
    process.exit(1);
  }
  if (!isQuiet) {
    console.log("✓");
  }

  // Create data directory
  if (!isQuiet) {
    process.stdout.write("Creating data directory... ");
  }
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!isQuiet) {
    console.log("✓");
  }

  // Initialize database
  if (!isQuiet) {
    process.stdout.write("Initializing database... ");
  }
  getDb(); // This creates and initializes the database
  if (!isQuiet) {
    console.log("✓");
  }

  // Save config (preserve existing learning_period_days on reinstall)
  if (!isQuiet) {
    process.stdout.write("Saving configuration... ");
  }
  const config = loadConfig();
  if (!isReinstall) {
    config.learning_period_days = learningPeriod;
  }
  saveConfig(config);
  if (!isQuiet) {
    console.log("✓");
  }

  // Install Claude Code hook
  if (!isQuiet) {
    process.stdout.write("Installing Claude Code hook... ");
  }
  const hookResult = installHook();
  if (!hookResult.success) {
    console.log("✗");
    console.error(`\nError installing hook: ${hookResult.error}`);
    process.exit(1);
  }
  if (!isQuiet) {
    console.log("✓");
  }

  // Install and start daemon service (persists across reboots)
  let daemonStarted = false;
  if (isPlatformSupported()) {
    const serviceName = getServiceTypeName();
    if (!isQuiet) {
      process.stdout.write(`Installing ${serviceName} service... `);
    }
    const serviceResult = installService();
    if (serviceResult.success) {
      if (!isQuiet) {
        console.log("✓");
      }

      // Enable service (for systemd, launchd auto-enables on load)
      enableService();

      // Start the service
      if (!isQuiet) {
        process.stdout.write(`Starting daemon... `);
      }
      const startResult = startService();
      if (startResult.success) {
        daemonStarted = true;
        if (!isQuiet) {
          console.log("✓");
        }
      } else {
        if (!isQuiet) {
          console.log("✗ (non-fatal)");
          console.log(`  Note: Daemon failed to start: ${startResult.error}`);
          console.log(`  You can start it manually with: ccmax daemon start`);
        }
      }
    } else {
      if (!isQuiet) {
        console.log("✗ (non-fatal)");
        console.log(`  Note: Service installation failed: ${serviceResult.error}`);
        console.log(`  You can install it manually with: ccmax daemon start --service`);
      }
    }
  }

  // Mark as installed early so configure and other commands work
  // (skip on reinstall to preserve installed_at timestamp)
  if (!isReinstall) {
    markInstalled();
  }

  // Run working hours configuration for fresh installs
  let workingHoursConfigured = isWorkingHoursConfigured();
  if (!isReinstall && !skipOnboarding && !isQuiet && !workingHoursConfigured) {
    console.log();
    await configure([]);
    workingHoursConfigured = isWorkingHoursConfigured();
  }

  // Offer sync setup for fresh installs (skip if already configured or reinstalling)
  let syncConfigured = isSyncConfigured();
  if (!isReinstall && !skipOnboarding && !isQuiet && !syncConfigured) {
    console.log();
    const setupSyncAnswer = await prompt("Configure GitHub Gist sync? (for multi-machine users) [y/N]: ");
    if (setupSyncAnswer.toLowerCase() === "y" || setupSyncAnswer.toLowerCase() === "yes") {
      console.log();
      console.log("Setting up GitHub Gist sync...");
      const syncResult = await setupSync();
      if (syncResult.success) {
        console.log("✓ " + syncResult.message);
        syncConfigured = true;
      } else {
        console.log("✗ " + syncResult.message);
        console.log("  You can set this up later with: ccmax sync setup");
      }
    }
  }

  if (!isQuiet) {
    console.log();
    console.log("═══════════════════════════════════════════════");
    console.log(isReinstall ? "Reinstall complete!" : "Setup complete!");
    console.log("═══════════════════════════════════════════════");
    console.log();
    console.log(`Binary installed to: ${INSTALLED_BINARY_PATH}`);
    if (daemonStarted) {
      console.log(`Daemon: Running (will persist across reboots)`);
    }
    if (workingHoursConfigured) {
      console.log(`Working hours: Configured (use 'ccmax configure show' to view)`);
    }
    if (syncConfigured) {
      console.log(`Sync: Configured (use 'ccmax sync push' to upload data)`);
    }

    if (!isReinstall) {
      console.log();
      if (workingHoursConfigured) {
        console.log("Your working hours are configured. The daemon will notify you at optimal times.");
      } else {
        console.log(`The tool will now track your usage patterns for ${learningPeriod} days.`);
        console.log();
        console.log("After the learning period, run:");
        console.log("  ccmax analyze  - See your usage patterns");
        console.log("  ccmax stats    - View usage over time");
      }
      console.log();
      console.log("Check progress anytime with: ccmax status");
    }

    // Check if bin dir is in PATH (macOS uses /usr/local/bin, Linux uses ~/.local/bin)
    const path = process.env.PATH ?? "";
    if (!path.includes(BIN_DIR)) {
      console.log();
      console.log(`NOTE: Add ${BIN_DIR} to your PATH to use 'ccmax' globally:`);
      console.log(`  export PATH="${BIN_DIR}:$PATH"`);
    }

    console.log();
  } else {
    console.log(isReinstall ? "ccmax reinstalled successfully." : "ccmax installed successfully.");
  }
}
