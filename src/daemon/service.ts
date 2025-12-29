import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SERVICE_NAME = "ccmax";
const SYSTEMD_USER_DIR = join(homedir(), ".config", "systemd", "user");
const SERVICE_FILE = join(SYSTEMD_USER_DIR, `${SERVICE_NAME}.service`);

function getServiceContent(): string {
  // For compiled Bun binaries, execPath is the binary itself
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

export function installService(): { success: boolean; error?: string } {
  try {
    // Create systemd user directory if it doesn't exist
    if (!existsSync(SYSTEMD_USER_DIR)) {
      mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
    }

    // Write service file
    writeFileSync(SERVICE_FILE, getServiceContent());

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

export function uninstallService(): { success: boolean; error?: string } {
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
    if (existsSync(SERVICE_FILE)) {
      unlinkSync(SERVICE_FILE);
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

export function startService(): { success: boolean; error?: string } {
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

export function stopService(): { success: boolean; error?: string } {
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

export function enableService(): { success: boolean; error?: string } {
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

export function isServiceRunning(): boolean {
  try {
    const result = execSync("systemctl --user is-active " + SERVICE_NAME, {
      encoding: "utf-8",
    });
    return result.trim() === "active";
  } catch {
    return false;
  }
}

export function isServiceEnabled(): boolean {
  try {
    const result = execSync("systemctl --user is-enabled " + SERVICE_NAME, {
      encoding: "utf-8",
    });
    return result.trim() === "enabled";
  } catch {
    return false;
  }
}

function execSync(command: string, options?: { encoding: "utf-8" }): string {
  const { execSync: nodeExecSync } = require("child_process");
  return nodeExecSync(command, { ...options, stdio: options?.encoding ? "pipe" : "inherit" });
}
