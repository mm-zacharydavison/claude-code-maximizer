import { spawn } from "bun";
import { join } from "path";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** stdout with ANSI codes stripped */
  cleanStdout: string;
}

const PROJECT_ROOT = join(import.meta.dir, "../..");

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Run ccmax CLI command with given arguments
 */
export async function runCcmax(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  const proc = spawn({
    cmd: ["bun", "run", join(PROJECT_ROOT, "src/cli/index.ts"), ...args],
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode, cleanStdout: stripAnsi(stdout) };
}

/**
 * Check if a process with given PID exists
 */
export function checkProcessExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process by PID (best effort)
 */
export function killProcess(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process may already be dead
  }
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await Bun.sleep(intervalMs);
  }
  return false;
}
