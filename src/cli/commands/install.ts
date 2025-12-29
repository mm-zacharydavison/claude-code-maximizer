import * as readline from "readline";
import { execSync } from "child_process";
import { installHook, isHookInstalled } from "../../hook/install.ts";
import { loadConfig, saveConfig } from "../../config/index.ts";
import { markInstalled, isInstalled } from "../../config/state.ts";
import { getDb } from "../../db/client.ts";
import { DATA_DIR, BIN_DIR, INSTALLED_BINARY_PATH } from "../../utils/paths.ts";
import { mkdirSync, existsSync, copyFileSync, chmodSync } from "fs";
import { dirname } from "path";

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

async function selectLearningPeriod(): Promise<number> {
  console.log("\nHow many days would you like to analyze before enabling auto-scheduling?");
  console.log("  [1] 3 days  (quick start, less accurate)");
  console.log("  [2] 7 days  (recommended)");
  console.log("  [3] 14 days (more accurate patterns)");
  console.log("  [4] Custom");
  console.log();

  const choice = await prompt("Enter choice [1-4]: ");

  switch (choice) {
    case "1":
      return 3;
    case "2":
      return 7;
    case "3":
      return 14;
    case "4": {
      const custom = await prompt("Enter number of days: ");
      const days = parseInt(custom, 10);
      if (isNaN(days) || days < 1) {
        console.log("Invalid input, defaulting to 7 days.");
        return 7;
      }
      return days;
    }
    default:
      console.log("Invalid choice, defaulting to 7 days.");
      return 7;
  }
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

  // Check if already installed
  if (isInstalled() && isHookInstalled() && existsSync(INSTALLED_BINARY_PATH)) {
    console.log("ccmax is already installed.");
    console.log("Run 'ccmax status' to check current status.");
    return;
  }

  if (!isQuiet) {
    console.log("╔═══════════════════════════════════════════════╗");
    console.log("║     Welcome to Claude Code Maximizer!         ║");
    console.log("╚═══════════════════════════════════════════════╝");
    console.log();
    console.log("This tool will help you optimize your Claude Code Max");
    console.log("5-hour rolling windows for maximum productivity.");
  }

  // Get learning period
  let learningPeriod = 7;
  if (!skipOnboarding && !isQuiet) {
    learningPeriod = await selectLearningPeriod();
  }

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

  // Save config
  if (!isQuiet) {
    process.stdout.write("Saving configuration... ");
  }
  const config = loadConfig();
  config.learning_period_days = learningPeriod;
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

  // Mark as installed
  markInstalled();

  if (!isQuiet) {
    console.log();
    console.log("═══════════════════════════════════════════════");
    console.log("Setup complete!");
    console.log("═══════════════════════════════════════════════");
    console.log();
    console.log(`Binary installed to: ${INSTALLED_BINARY_PATH}`);
    console.log();
    console.log(`The tool will now track your usage patterns for ${learningPeriod} days.`);
    console.log();
    console.log("After the learning period, run:");
    console.log("  ccmax analyze       - See your usage patterns");
    console.log("  ccmax daemon start  - Enable automatic notifications");
    console.log();
    console.log("Check progress anytime with: ccmax status");

    // Check if ~/.local/bin is in PATH
    const path = process.env.PATH ?? "";
    if (!path.includes(BIN_DIR)) {
      console.log();
      console.log("NOTE: Add ~/.local/bin to your PATH to use 'ccmax' globally:");
      console.log('  export PATH="$HOME/.local/bin:$PATH"');
    }

    console.log();
  } else {
    console.log("ccmax installed successfully.");
  }
}
