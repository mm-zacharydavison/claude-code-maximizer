import { spawn } from "child_process";
import * as fs from "fs";
import { isInstalled } from "../../config/state.ts";
import { loadState, setDaemonPid } from "../../config/state.ts";
import { startDaemon, isDaemonRunning } from "../../daemon/index.ts";
import {
  installService,
  uninstallService,
  startService,
  stopService,
  enableService,
  isServiceRunning,
  isServiceEnabled,
  getServiceTypeName,
} from "../../daemon/service.ts";
import { LOG_DIR, DAEMON_LOG_PATH } from "../../utils/paths.ts";
import { isMacOS, isLinux, isPlatformSupported, getPlatformName } from "../../utils/platform.ts";

export async function daemon(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
    return;
  }

  if (!isPlatformSupported()) {
    console.log(`Daemon is not supported on ${getPlatformName()}.`);
    console.log("Supported platforms: Linux, macOS");
    return;
  }

  switch (subcommand) {
    case "start":
      await daemonStart(args.slice(1));
      break;

    case "stop":
      await daemonStop();
      break;

    case "status":
      await daemonStatus();
      break;

    case "run":
      // Internal command - runs the daemon in foreground
      startDaemon();
      break;

    case "install-service":
      await installPlatformService();
      break;

    case "uninstall-service":
      await uninstallPlatformService();
      break;

    case "logs":
      await daemonLogs(args.slice(1));
      break;

    default:
      showDaemonHelp();
  }
}

async function daemonStart(args: string[]): Promise<void> {
  const useService = args.includes("--service") || args.includes("--systemd") || args.includes("--launchd");
  const state = loadState();

  // Check if already running
  if (isDaemonRunning(state.daemon_pid)) {
    console.log(`Daemon is already running (PID: ${state.daemon_pid})`);
    return;
  }

  if (useService) {
    const serviceType = getServiceTypeName();
    console.log(`Starting daemon via ${serviceType}...`);

    // Install and enable service if not already
    if (!isServiceEnabled()) {
      const installResult = installService();
      if (!installResult.success) {
        console.error(`Failed to install service: ${installResult.error}`);
        return;
      }

      const enableResult = enableService();
      if (!enableResult.success) {
        console.error(`Failed to enable service: ${enableResult.error}`);
        return;
      }
    }

    const result = startService();
    if (result.success) {
      console.log(`Daemon started via ${serviceType}.`);
      console.log("It will automatically restart on boot.");
    } else {
      console.error(`Failed to start daemon: ${result.error}`);
    }
  } else {
    // Start in background
    console.log("Starting daemon in background...");

    // Set up log file for daemon output
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = fs.openSync(DAEMON_LOG_PATH, "a");

    // For compiled Bun binaries, execPath is the binary itself (not the bun runtime)
    const child = spawn(process.execPath, ["daemon", "run"], {
      detached: true,
      stdio: ["ignore", logFile, logFile],
    });

    child.unref();
    fs.closeSync(logFile); // Close fd in parent after spawn

    if (child.pid) {
      setDaemonPid(child.pid);
      console.log(`Daemon started (PID: ${child.pid})`);
      console.log();
      console.log("Note: This daemon will stop when you log out.");
      console.log(`For persistent operation, use: ccmax daemon start --service`);
    } else {
      console.error("Failed to start daemon.");
    }
  }
}

async function daemonStop(): Promise<void> {
  const state = loadState();

  // Check platform service first
  if (isServiceRunning()) {
    const serviceType = getServiceTypeName();
    console.log(`Stopping daemon via ${serviceType}...`);
    const result = stopService();
    if (result.success) {
      console.log("Daemon stopped.");
    } else {
      console.error(`Failed to stop daemon: ${result.error}`);
    }
    return;
  }

  // Check for background process
  if (!isDaemonRunning(state.daemon_pid)) {
    console.log("Daemon is not running.");
    return;
  }

  try {
    process.kill(state.daemon_pid!, "SIGTERM");
    setDaemonPid(null);
    console.log("Daemon stopped.");
  } catch (err) {
    console.error(`Failed to stop daemon: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

async function daemonStatus(): Promise<void> {
  const state = loadState();
  const serviceType = getServiceTypeName();

  console.log();
  console.log("Daemon Status");
  console.log("─".repeat(40));

  // Check platform service
  const serviceEnabled = isServiceEnabled();
  const serviceRunning = isServiceRunning();

  if (serviceEnabled || serviceRunning) {
    const serviceLabel = serviceType.charAt(0).toUpperCase() + serviceType.slice(1);
    console.log(`  ${serviceLabel} service: ${serviceRunning ? "✓ Running" : "✗ Stopped"}`);
    console.log(`  Auto-start:       ${serviceEnabled ? "✓ Enabled" : "✗ Disabled"}`);
  }

  // Check background process
  const bgRunning = isDaemonRunning(state.daemon_pid);
  if (bgRunning) {
    console.log(`  Background PID:   ${state.daemon_pid}`);
  }

  if (!serviceRunning && !bgRunning) {
    console.log("  Status:           ✗ Not running");
    console.log();
    console.log("Start the daemon with: ccmax daemon start");
  }

  console.log();
}

async function installPlatformService(): Promise<void> {
  const serviceType = getServiceTypeName();
  console.log(`Installing ${serviceType} service...`);

  const result = installService();
  if (result.success) {
    console.log("Service installed successfully.");
    console.log();
    console.log(`To start the service: ccmax daemon start --service`);
  } else {
    console.error(`Failed to install service: ${result.error}`);
  }
}

async function uninstallPlatformService(): Promise<void> {
  const serviceType = getServiceTypeName();
  console.log(`Uninstalling ${serviceType} service...`);

  const result = uninstallService();
  if (result.success) {
    console.log("Service uninstalled successfully.");
  } else {
    console.error(`Failed to uninstall service: ${result.error}`);
  }
}

async function daemonLogs(args: string[]): Promise<void> {
  const follow = args.includes("-f") || args.includes("--follow");
  const clearFlag = args.includes("--clear");

  // Parse --tail or -n for number of lines
  let tailLines: number | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tail" || args[i] === "-n") {
      const arg = args[i + 1]
      if (!arg) { return }
      const num = parseInt(arg, 10);
      if (!isNaN(num)) {
        tailLines = num;
      }
    }
  }

  // Default to 50 lines if not following
  if (tailLines === null && !follow) {
    tailLines = 50;
  }

  if (clearFlag) {
    try {
      fs.unlinkSync(DAEMON_LOG_PATH);
      console.log("Daemon logs cleared.");
    } catch {
      console.log("No logs to clear.");
    }
    return;
  }

  // Check if running under systemd - if so, use journalctl
  if (isLinux() && isServiceRunning()) {
    await showSystemdLogs(follow, tailLines);
    return;
  }

  // For macOS launchd or background process, use log file
  if (!fs.existsSync(DAEMON_LOG_PATH)) {
    console.log("No daemon logs found.");
    console.log();
    console.log(`Log file location: ${DAEMON_LOG_PATH}`);
    console.log();
    console.log("Logs are created when the daemon runs.");
    console.log("Start the daemon with: ccmax daemon start");
    return;
  }

  if (follow) {
    // Use tail -f for following logs
    console.log(`Following ${DAEMON_LOG_PATH} (Ctrl+C to stop)`);
    console.log("─".repeat(50));
    const child = spawn("tail", ["-f", DAEMON_LOG_PATH], {
      stdio: "inherit",
    });
    // Wait for the process (user will Ctrl+C)
    await new Promise<void>((resolve) => {
      child.on("close", () => resolve());
    });
  } else {
    // Read and display logs
    const content = fs.readFileSync(DAEMON_LOG_PATH, "utf-8");
    const lines = content.trim().split("\n");

    const displayLines = tailLines ? lines.slice(-tailLines) : lines;

    if (displayLines.length === 0) {
      console.log("Log file exists but is empty.");
      return;
    }

    console.log(`Daemon logs (last ${displayLines.length} lines)`);
    console.log(`File: ${DAEMON_LOG_PATH}`);
    console.log("─".repeat(50));
    for (const line of displayLines) {
      console.log(line);
    }

    if (lines.length > displayLines.length) {
      console.log("─".repeat(50));
      console.log(`Showing ${displayLines.length} of ${lines.length} lines. Use --tail N for more.`);
    }
  }
}

async function showSystemdLogs(follow: boolean, tailLines: number | null): Promise<void> {
  const args = ["--user", "-u", "ccmax", "--no-pager"];

  if (follow) {
    args.push("-f");
    console.log("Following systemd journal (Ctrl+C to stop)");
    console.log("─".repeat(50));
  } else {
    if (tailLines) {
      args.push("-n", String(tailLines));
    }
    console.log(`Daemon logs from systemd journal${tailLines ? ` (last ${tailLines} lines)` : ""}`);
    console.log("─".repeat(50));
  }

  const child = spawn("journalctl", args, {
    stdio: "inherit",
  });

  await new Promise<void>((resolve) => {
    child.on("close", () => resolve());
  });
}

function showDaemonHelp(): void {
  const serviceType = getServiceTypeName();
  const serviceFlag = isMacOS() ? "--launchd" : isLinux() ? "--systemd" : "--service";

  console.log(`
ccmax daemon - Manage the background daemon

USAGE:
  ccmax daemon <subcommand>

SUBCOMMANDS:
  start             Start the daemon in background
  start --service   Start via ${serviceType} (persists across reboots)
  stop              Stop the daemon
  status            Show daemon status
  logs              View daemon logs
  install-service   Install ${serviceType} user service
  uninstall-service Remove ${serviceType} user service

LOG OPTIONS:
  logs              Show last 50 lines of logs
  logs -f           Follow logs in real-time (like tail -f)
  logs --tail N     Show last N lines
  logs --clear      Delete the log file

EXAMPLES:
  ccmax daemon start            Start daemon (stops on logout)
  ccmax daemon start --service  Start with ${serviceType} (auto-restarts)
  ccmax daemon start ${serviceFlag}  Same as --service
  ccmax daemon stop             Stop the daemon
  ccmax daemon status           Check if daemon is running
  ccmax daemon logs -f          Follow daemon logs in real-time
`);
}
