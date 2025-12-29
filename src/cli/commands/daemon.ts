import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
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
} from "../../daemon/service.ts";

export async function daemon(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
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
      await installSystemdService();
      break;

    case "uninstall-service":
      await uninstallSystemdService();
      break;

    default:
      showDaemonHelp();
  }
}

async function daemonStart(args: string[]): Promise<void> {
  const useSystemd = args.includes("--systemd");
  const state = loadState();

  // Check if already running
  if (isDaemonRunning(state.daemon_pid)) {
    console.log(`Daemon is already running (PID: ${state.daemon_pid})`);
    return;
  }

  if (useSystemd) {
    // Use systemd
    console.log("Starting daemon via systemd...");

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
      console.log("Daemon started via systemd.");
      console.log("It will automatically restart on boot.");
    } else {
      console.error(`Failed to start daemon: ${result.error}`);
    }
  } else {
    // Start in background
    console.log("Starting daemon in background...");

    // Set up log file for daemon output
    const logDir = path.join(homedir(), ".local", "share", "ccmax");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "daemon.log");
    const logFile = fs.openSync(logPath, "a");

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
      console.log("For persistent operation, use: ccmax daemon start --systemd");
    } else {
      console.error("Failed to start daemon.");
    }
  }
}

async function daemonStop(): Promise<void> {
  const state = loadState();

  // Check systemd first
  if (isServiceRunning()) {
    console.log("Stopping daemon via systemd...");
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

  console.log();
  console.log("Daemon Status");
  console.log("─".repeat(40));

  // Check systemd service
  const serviceEnabled = isServiceEnabled();
  const serviceRunning = isServiceRunning();

  if (serviceEnabled || serviceRunning) {
    console.log(`  Systemd service:  ${serviceRunning ? "✓ Running" : "✗ Stopped"}`);
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

async function installSystemdService(): Promise<void> {
  console.log("Installing systemd service...");

  const result = installService();
  if (result.success) {
    console.log("Service installed successfully.");
    console.log();
    console.log("To start the service: ccmax daemon start --systemd");
  } else {
    console.error(`Failed to install service: ${result.error}`);
  }
}

async function uninstallSystemdService(): Promise<void> {
  console.log("Uninstalling systemd service...");

  const result = uninstallService();
  if (result.success) {
    console.log("Service uninstalled successfully.");
  } else {
    console.error(`Failed to uninstall service: ${result.error}`);
  }
}

function showDaemonHelp(): void {
  console.log(`
ccmax daemon - Manage the background daemon

USAGE:
  ccmax daemon <subcommand>

SUBCOMMANDS:
  start             Start the daemon in background
  start --systemd   Start via systemd (persists across reboots)
  stop              Stop the daemon
  status            Show daemon status
  install-service   Install systemd user service
  uninstall-service Remove systemd user service

EXAMPLES:
  ccmax daemon start          Start daemon (stops on logout)
  ccmax daemon start --systemd  Start with systemd (auto-restarts)
  ccmax daemon stop           Stop the daemon
  ccmax daemon status         Check if daemon is running
`);
}
