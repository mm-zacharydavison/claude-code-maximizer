import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { isMacOS, isLinux, getPlatformName } from "../utils/platform.ts";
import {
  LAUNCHD_AGENTS_DIR,
  LAUNCHD_PLIST_PATH,
  SYSTEMD_USER_DIR,
  SYSTEMD_SERVICE_PATH,
  LOG_DIR,
  DAEMON_LOG_PATH,
} from "../utils/paths.ts";

const SERVICE_NAME = "ccmax";
const LAUNCHD_LABEL = "com.ccmax.daemon";

// ============================================================================
// Cross-platform service management
// ============================================================================

export function installService(): { success: boolean; error?: string } {
  if (isMacOS()) {
    return installLaunchdService();
  } else if (isLinux()) {
    return installSystemdService();
  }
  return { success: false, error: `Unsupported platform: ${getPlatformName()}` };
}

export function uninstallService(): { success: boolean; error?: string } {
  if (isMacOS()) {
    return uninstallLaunchdService();
  } else if (isLinux()) {
    return uninstallSystemdService();
  }
  return { success: false, error: `Unsupported platform: ${getPlatformName()}` };
}

export function startService(): { success: boolean; error?: string } {
  if (isMacOS()) {
    return startLaunchdService();
  } else if (isLinux()) {
    return startSystemdService();
  }
  return { success: false, error: `Unsupported platform: ${getPlatformName()}` };
}

export function stopService(): { success: boolean; error?: string } {
  if (isMacOS()) {
    return stopLaunchdService();
  } else if (isLinux()) {
    return stopSystemdService();
  }
  return { success: false, error: `Unsupported platform: ${getPlatformName()}` };
}

export function enableService(): { success: boolean; error?: string } {
  if (isMacOS()) {
    // On macOS, loading the plist enables it
    return { success: true };
  } else if (isLinux()) {
    return enableSystemdService();
  }
  return { success: false, error: `Unsupported platform: ${getPlatformName()}` };
}

export function isServiceRunning(): boolean {
  if (isMacOS()) {
    return isLaunchdServiceRunning();
  } else if (isLinux()) {
    return isSystemdServiceRunning();
  }
  return false;
}

export function isServiceEnabled(): boolean {
  if (isMacOS()) {
    return isLaunchdServiceEnabled();
  } else if (isLinux()) {
    return isSystemdServiceEnabled();
  }
  return false;
}

/**
 * Get the service type name for display purposes
 */
export function getServiceTypeName(): string {
  if (isMacOS()) {
    return "launchd";
  } else if (isLinux()) {
    return "systemd";
  }
  return "service";
}

// ============================================================================
// macOS launchd implementation
// ============================================================================

function getLaunchdPlistContent(): string {
  const binPath = process.execPath;

  // Ensure log directory exists
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${binPath}</string>
        <string>daemon</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${DAEMON_LOG_PATH}</string>
    <key>StandardErrorPath</key>
    <string>${DAEMON_LOG_PATH}</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
`;
}

function installLaunchdService(): { success: boolean; error?: string } {
  try {
    // Create LaunchAgents directory if it doesn't exist
    if (!existsSync(LAUNCHD_AGENTS_DIR)) {
      mkdirSync(LAUNCHD_AGENTS_DIR, { recursive: true });
    }

    // Unload existing service if present (ignore errors)
    try {
      execSync(`launchctl unload "${LAUNCHD_PLIST_PATH}" 2>/dev/null`);
    } catch {
      // Ignore - service may not be loaded
    }

    // Write plist file
    writeFileSync(LAUNCHD_PLIST_PATH, getLaunchdPlistContent());

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function uninstallLaunchdService(): { success: boolean; error?: string } {
  try {
    // Unload service if running
    try {
      execSync(`launchctl unload "${LAUNCHD_PLIST_PATH}" 2>/dev/null`);
    } catch {
      // Ignore if not loaded
    }

    // Remove plist file
    if (existsSync(LAUNCHD_PLIST_PATH)) {
      unlinkSync(LAUNCHD_PLIST_PATH);
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function startLaunchdService(): { success: boolean; error?: string } {
  try {
    // Ensure plist exists
    if (!existsSync(LAUNCHD_PLIST_PATH)) {
      const installResult = installLaunchdService();
      if (!installResult.success) {
        return installResult;
      }
    }

    // Load the service (this also starts it due to RunAtLoad)
    execSync(`launchctl load "${LAUNCHD_PLIST_PATH}"`);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function stopLaunchdService(): { success: boolean; error?: string } {
  try {
    execSync(`launchctl unload "${LAUNCHD_PLIST_PATH}"`);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function isLaunchdServiceRunning(): boolean {
  try {
    const result = execSync(`launchctl list | grep "${LAUNCHD_LABEL}"`, {
      encoding: "utf-8",
    });
    // launchctl list output: PID Status Label
    // If PID is a number (not "-"), the service is running
    const parts = result.trim().split(/\s+/);
    const pid = parts[0] ?? "-";
    return parts.length >= 1 && pid !== "-" && !isNaN(parseInt(pid));
  } catch {
    return false;
  }
}

function isLaunchdServiceEnabled(): boolean {
  // On macOS, if the plist exists in LaunchAgents, it's "enabled"
  return existsSync(LAUNCHD_PLIST_PATH);
}

// ============================================================================
// Linux systemd implementation
// ============================================================================

function getSystemdServiceContent(): string {
  const binPath = process.execPath;

  return `[Unit]
Description=Claude Code Maximizer Daemon
After=default.target

[Service]
Type=simple
ExecStart=${binPath} daemon run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

function installSystemdService(): { success: boolean; error?: string } {
  try {
    // Create systemd user directory if it doesn't exist
    if (!existsSync(SYSTEMD_USER_DIR)) {
      mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
    }

    // Write service file
    writeFileSync(SYSTEMD_SERVICE_PATH, getSystemdServiceContent());

    // Reload systemd
    execSync("systemctl --user daemon-reload");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function uninstallSystemdService(): { success: boolean; error?: string } {
  try {
    // Stop service if running
    try {
      execSync("systemctl --user stop " + SERVICE_NAME);
    } catch {
      // Ignore if not running
    }

    // Disable service
    try {
      execSync("systemctl --user disable " + SERVICE_NAME);
    } catch {
      // Ignore if not enabled
    }

    // Remove service file
    if (existsSync(SYSTEMD_SERVICE_PATH)) {
      unlinkSync(SYSTEMD_SERVICE_PATH);
    }

    // Reload systemd
    execSync("systemctl --user daemon-reload");

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function startSystemdService(): { success: boolean; error?: string } {
  try {
    execSync("systemctl --user start " + SERVICE_NAME);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function stopSystemdService(): { success: boolean; error?: string } {
  try {
    execSync("systemctl --user stop " + SERVICE_NAME);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function enableSystemdService(): { success: boolean; error?: string } {
  try {
    execSync("systemctl --user enable " + SERVICE_NAME);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function isSystemdServiceRunning(): boolean {
  try {
    const result = execSync("systemctl --user is-active " + SERVICE_NAME, {
      encoding: "utf-8",
    });
    return result.trim() === "active";
  } catch {
    return false;
  }
}

function isSystemdServiceEnabled(): boolean {
  try {
    const result = execSync("systemctl --user is-enabled " + SERVICE_NAME, {
      encoding: "utf-8",
    });
    return result.trim() === "enabled";
  } catch {
    return false;
  }
}

// ============================================================================
// Utility
// ============================================================================

function execSync(command: string, options?: { encoding: "utf-8" }): string {
  const { execSync: nodeExecSync } = require("child_process");
  return nodeExecSync(command, { ...options, stdio: options?.encoding ? "pipe" : "inherit" });
}
