import { spawn, spawnSync } from "bun";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { isMacOS } from "../utils/platform.ts";

const GREETING_MESSAGES = [
  "Hi.",
  "Hello.",
  "Hey.",
  "Good morning.",
  "Good afternoon.",
  "Good evening.",
  "Hi there.",
  "Hello there.",
  "Hey there.",
  "Greetings.",
  "Hi Claude.",
  "Hello Claude.",
  "Hey Claude.",
  "What's up?",
  "How are you?"
];

function getRandomGreeting(): string {
  const index = Math.floor(Math.random() * GREETING_MESSAGES.length);
  return GREETING_MESSAGES[index] ?? "Hi.";
}

function findClaudeBinary(): string | null {
  // First try `which claude` to find it in PATH
  try {
    const result = spawnSync(["which", "claude"]);
    if (result.exitCode === 0) {
      const path = result.stdout.toString().trim();
      if (path && existsSync(path)) {
        return path;
      }
    }
  } catch {
    // Fall through to manual search
  }

  // Fall back to known locations
  const home = homedir();
  const candidates = [
    join(home, ".claude", "local", "claude"),
    join(home, ".claude", "bin", "claude"),
    join(home, ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}

/**
 * Kill orphaned script and claude processes associated with a temp file.
 * On macOS, when bash exits, script and claude become orphaned (re-parented to launchd).
 */
function killOrphanedProcesses(tmpFile: string): void {
  if (!isMacOS()) return;

  try {
    const pgrepResult = spawnSync(["pgrep", "-f", tmpFile]);
    if (pgrepResult.exitCode === 0) {
      const pids = pgrepResult.stdout.toString().trim().split("\n");
      for (const pid of pids) {
        if (pid) {
          spawnSync(["pkill", "-P", pid]);
          spawnSync(["kill", "-TERM", pid]);
        }
      }
    }
  } catch {
    // Ignore errors - processes may already be dead
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SpawnResult {
  success: boolean;
  message: string;
  greeting?: string;
}

/**
 * Spawn a Claude session, send a greeting message, wait for response, then exit.
 * Uses the same PTY mechanism as the /usage command.
 */
export async function spawnClaudeSession(): Promise<SpawnResult> {
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    return { success: false, message: "Claude binary not found" };
  }

  const greeting = getRandomGreeting();
  const tmpFile = `/tmp/ccmax-autostart-${Date.now()}.txt`;
  const scriptFile = `/tmp/ccmax-autostart-${Date.now()}.sh`;

  // Escape the greeting for shell
  const escapedGreeting = greeting.replace(/'/g, "'\\''");

  // Create a shell script that:
  // 1. Uses `script` to create a PTY
  // 2. Sends the greeting message
  // 3. Waits for response
  // 4. Exits
  const interactiveScript = `#!/bin/bash
{
  sleep 3
  printf '${escapedGreeting}'
  sleep 0.3
  printf '\\x1b'  # Escape to dismiss autocomplete
  sleep 0.2
  printf '\\r'    # Carriage return to send
  sleep 10        # Wait for Claude to respond
  printf '/exit'
  sleep 0.2
  printf '\\x1b'  # Escape to dismiss autocomplete
  sleep 0.2
  printf '\\r'    # Carriage return to execute
  sleep 1
} | ${isMacOS()
    ? `script -q "${tmpFile}" "${claudePath}"`
    : `script -q -c "${claudePath}" "${tmpFile}"`}
`;

  try {
    writeFileSync(scriptFile, interactiveScript, { mode: 0o755 });

    const proc = spawn(["bash", scriptFile], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, TERM: "xterm-256color" },
    });

    // Wait for completion with timeout
    const timeoutPromise = sleep(25000).then(() => "timeout");
    const exitPromise = proc.exited.then(() => "done");
    const raceResult = await Promise.race([exitPromise, timeoutPromise]);

    if (raceResult === "timeout") {
      try {
        proc.kill();
      } catch {
        // Already dead
      }
    }

    // Wait a bit for script/claude to finish
    await sleep(3000);

    // Clean up orphaned processes
    killOrphanedProcesses(tmpFile);

    // Clean up temp files
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
      if (existsSync(scriptFile)) unlinkSync(scriptFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: true,
      message: "Claude session started and completed",
      greeting,
    };
  } catch (error) {
    // Clean up on error
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
      if (existsSync(scriptFile)) unlinkSync(scriptFile);
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
