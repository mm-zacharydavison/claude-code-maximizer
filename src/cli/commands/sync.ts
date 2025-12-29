import { setupSync, pushToGist, pullFromGist } from "../../sync/gist.ts";
import { getSyncConfig, isSyncConfigured } from "../../config/index.ts";

export async function sync(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "setup":
      await handleSetup(args.slice(1));
      break;
    case "push":
      await handlePush();
      break;
    case "pull":
      await handlePull();
      break;
    case "status":
      handleStatus();
      break;
    default:
      printUsage();
  }
}

async function handleSetup(args: string[]): Promise<void> {
  // Check for existing gist ID argument
  let existingGistId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--gist" && args[i + 1]) {
      existingGistId = args[i + 1];
      break;
    }
  }

  console.log("Setting up GitHub Gist sync...\n");

  const result = await setupSync(existingGistId);

  if (result.success) {
    console.log("✓ " + result.message);
  } else {
    console.log("✗ " + result.message);
    process.exit(1);
  }
}

async function handlePush(): Promise<void> {
  if (!isSyncConfigured()) {
    console.log("Sync not configured. Run 'ccmax sync setup' first.");
    process.exit(1);
  }

  console.log("Pushing to GitHub Gist...");

  const result = await pushToGist();

  if (result.success) {
    console.log("✓ " + result.message);
  } else {
    console.log("✗ " + result.message);
    process.exit(1);
  }
}

async function handlePull(): Promise<void> {
  if (!isSyncConfigured()) {
    console.log("Sync not configured. Run 'ccmax sync setup' first.");
    process.exit(1);
  }

  console.log("Pulling from GitHub Gist...");

  const result = await pullFromGist();

  if (result.success) {
    console.log("✓ " + result.message);

    if (result.data) {
      console.log("\nMachines synced:");
      for (const [id, machine] of Object.entries(result.data.machines)) {
        console.log(`  ${machine.hostname} (${id})`);
        console.log(`    Last update: ${new Date(machine.last_update).toLocaleString()}`);
        console.log(`    Windows: ${machine.windows.length}`);
      }
    }
  } else {
    console.log("✗ " + result.message);
    process.exit(1);
  }
}

function handleStatus(): void {
  const config = getSyncConfig();

  console.log("Sync Status");
  console.log("─".repeat(40));

  if (!config.gist_id) {
    console.log("  Status: Not configured");
    console.log("\n  Run 'ccmax sync setup' to configure.");
  } else {
    console.log("  Status: Configured");
    console.log(`  Gist ID: ${config.gist_id}`);
    console.log(`  Machine ID: ${config.machine_id || "Not set"}`);
    console.log(`  Last sync: ${config.last_sync ? new Date(config.last_sync).toLocaleString() : "Never"}`);
    console.log(`\n  Gist URL: https://gist.github.com/${config.gist_id}`);
  }
}

function printUsage(): void {
  console.log(`
Usage: ccmax sync <command>

Commands:
  setup [--gist <id>]   Configure sync with GitHub Gist
                        Use --gist to connect to an existing gist
  push                  Push local data to gist
  pull                  Pull data from gist
  status                Show sync status

Examples:
  ccmax sync setup                    Create a new gist for sync
  ccmax sync setup --gist abc123      Connect to existing gist
  ccmax sync push                     Upload local data
  ccmax sync pull                     Download synced data
`.trim());
}
