import { spawn } from "child_process";
import { isMacOS, isLinux } from "../utils/platform.ts";

export interface NotificationOptions {
  title: string;
  message: string;
  urgency?: "low" | "normal" | "critical";
  icon?: string;
}

export async function sendNotification(options: NotificationOptions): Promise<boolean> {
  if (isMacOS()) {
    return sendMacOSNotification(options);
  } else if (isLinux()) {
    return sendLinuxNotification(options);
  }
  return false;
}

/**
 * Send notification on macOS using osascript (AppleScript)
 */
async function sendMacOSNotification(options: NotificationOptions): Promise<boolean> {
  const { title, message } = options;

  try {
    // Escape quotes for AppleScript
    const escapedTitle = title.replace(/"/g, '\\"');
    const escapedMessage = message.replace(/"/g, '\\"');

    const script = `display notification "${escapedMessage}" with title "${escapedTitle}"`;

    const proc = spawn("osascript", ["-e", script], {
      stdio: "ignore",
      detached: true,
    });

    return new Promise((resolve) => {
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
      proc.unref();
    });
  } catch {
    return false;
  }
}

/**
 * Send notification on Linux using notify-send (libnotify)
 */
async function sendLinuxNotification(options: NotificationOptions): Promise<boolean> {
  const { title, message, urgency = "normal" } = options;

  try {
    const args = [
      `--urgency=${urgency}`,
      "--app-name=ccmax",
      title,
      message,
    ];

    const proc = spawn("notify-send", args, {
      stdio: "ignore",
      detached: true,
    });

    return new Promise((resolve) => {
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
      proc.unref();
    });
  } catch {
    return false;
  }
}

export async function notifyOptimalTime(startTime: string): Promise<boolean> {
  return sendNotification({
    title: "Claude Code - Optimal Start Time",
    message: `It's ${startTime}! This is a good time to start your Claude Code session for optimal window usage.`,
    urgency: "normal",
  });
}

export async function notifyWindowEnding(minutesLeft: number): Promise<boolean> {
  return sendNotification({
    title: "Claude Code - Window Ending Soon",
    message: `Your 5-hour Claude Code Max rate-limit window ends in ${minutesLeft} minutes.`,
    urgency: minutesLeft <= 15 ? "critical" : "normal",
  });
}
