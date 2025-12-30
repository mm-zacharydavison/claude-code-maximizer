import { spawn, spawnSync } from "bun";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { USAGE_CACHE_PATH, CACHE_DIR } from "../utils/paths.ts";
import { isMacOS } from "../utils/platform.ts";

const DEFAULT_CACHE_TTL = 300; // 5 minutes

export interface UsageSection {
  percentage: number | null;
  resets_at: string | null;
  resets_at_iso: string | null; // ISO 8601 timestamp for programmatic use
}

export interface ClaudeUsage {
  session: UsageSection;
  week_all_models: UsageSection;
  week_sonnet: UsageSection;
  cached?: boolean;
  cache_age?: number;
}

interface CacheData {
  timestamp: number;
  data: ClaudeUsage;
}

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadCache(): CacheData | null {
  try {
    if (existsSync(USAGE_CACHE_PATH)) {
      const content = readFileSync(USAGE_CACHE_PATH, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // Ignore cache errors
  }
  return null;
}

function saveCache(data: ClaudeUsage): void {
  ensureCacheDir();
  const cacheData: CacheData = {
    timestamp: Date.now() / 1000,
    data,
  };
  try {
    writeFileSync(USAGE_CACHE_PATH, JSON.stringify(cacheData));
  } catch {
    // Ignore cache errors
  }
}

export function getCachedUsage(ttl: number = DEFAULT_CACHE_TTL): ClaudeUsage | null {
  const cache = loadCache();
  if (cache && cache.timestamp && cache.data) {
    const age = Date.now() / 1000 - cache.timestamp;
    if (age < ttl) {
      return {
        ...cache.data,
        cached: true,
        cache_age: Math.round(age),
      };
    }
  }
  return null;
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

function stripAnsi(str: string): string {
  // Remove ANSI escape codes
  return str.replace(/\u001b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function parseResetTime(resetStr: string): string | null {
  // Parse reset time strings like:
  // "6pm (Europe/Berlin)"
  // "5:59pm (Europe/Berlin)"
  // "Jan 3, 2026, 12am (Europe/Berlin)"

  if (!resetStr) return null;

  try {
    // Remove timezone part for parsing (we parse in local time)
    const timePartRaw = resetStr.replace(/\s*\([^)]+\)\s*/, "").trim();

    // Get current date for reference
    const now = new Date();

    // Try to parse different formats
    let targetDate: Date | null = null;

    // Format: "6pm" or "5:59pm" (time only, today)
    const timeOnlyMatch = timePartRaw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (timeOnlyMatch && timeOnlyMatch[1] && timeOnlyMatch[3]) {
      let hours = parseInt(timeOnlyMatch[1], 10);
      const minutes = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2], 10) : 0;
      const isPm = timeOnlyMatch[3].toLowerCase() === "pm";

      if (isPm && hours !== 12) hours += 12;
      if (!isPm && hours === 12) hours = 0;

      targetDate = new Date(now);
      targetDate.setHours(hours, minutes, 0, 0);

      // If this time has already passed today, it's probably tomorrow
      if (targetDate <= now) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
    }

    // Format: "Jan 3, 2026, 12am" (full date)
    const fullDateMatch = timePartRaw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (fullDateMatch && fullDateMatch[1] && fullDateMatch[2] && fullDateMatch[3] && fullDateMatch[4] && fullDateMatch[6]) {
      const monthStr = fullDateMatch[1];
      const day = parseInt(fullDateMatch[2], 10);
      const year = parseInt(fullDateMatch[3], 10);
      let hours = parseInt(fullDateMatch[4], 10);
      const minutes = fullDateMatch[5] ? parseInt(fullDateMatch[5], 10) : 0;
      const isPm = fullDateMatch[6].toLowerCase() === "pm";

      if (isPm && hours !== 12) hours += 12;
      if (!isPm && hours === 12) hours = 0;

      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      const month = months[monthStr.toLowerCase().slice(0, 3)] ?? 0;

      targetDate = new Date(year, month, day, hours, minutes, 0, 0);
    }

    if (targetDate) {
      return targetDate.toISOString();
    }
  } catch {
    // Parsing failed
  }

  return null;
}

function parseUsageOutput(output: string): ClaudeUsage {
  const result: ClaudeUsage = {
    session: { percentage: null, resets_at: null, resets_at_iso: null },
    week_all_models: { percentage: null, resets_at: null, resets_at_iso: null },
    week_sonnet: { percentage: null, resets_at: null, resets_at_iso: null },
  };

  // Strip ANSI codes from output
  const cleanOutput = stripAnsi(output);
  const lines = cleanOutput.split("\n");
  let currentSection: keyof ClaudeUsage | null = null;

  for (const line of lines) {
    const lineLower = line.toLowerCase();

    // Detect section headers
    if (lineLower.includes("current session")) {
      currentSection = "session";
    } else if (lineLower.includes("current week") && lineLower.includes("all models")) {
      currentSection = "week_all_models";
    } else if (lineLower.includes("current week") && lineLower.includes("sonnet")) {
      currentSection = "week_sonnet";
    } else if (lineLower.includes("extra usage")) {
      currentSection = null;
    }

    if (currentSection && currentSection in result) {
      // Look for percentage
      const pctMatch = line.match(/(\d+)%\s*used/);
      if (pctMatch?.[1]) {
        (result[currentSection] as UsageSection).percentage = parseInt(pctMatch[1], 10);
      }

      // Look for reset time
      const resetMatch = line.match(/Resets\s+(.+?)(?:\s*$)/);
      if (resetMatch?.[1]) {
        const resetStr = resetMatch[1].trim();
        (result[currentSection] as UsageSection).resets_at = resetStr;
        (result[currentSection] as UsageSection).resets_at_iso = parseResetTime(resetStr);
      }
    }
  }

  return result;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchClaudeUsage(claudePath: string, _timeout: number): Promise<ClaudeUsage | null> {
  const tmpFile = `/tmp/ccmax-usage-${Date.now()}.txt`;
  const scriptFile = `/tmp/ccmax-script-${Date.now()}.sh`;

  // Create a shell script that handles the interactive session
  // This script:
  // 1. Uses `script` to create a PTY
  // 2. Runs Claude in a subshell
  // 3. Sends /usage command after Claude starts
  // 4. Waits for output and exits
  const interactiveScript = `#!/bin/bash
# Run Claude with script providing PTY, capturing to output file
{
  sleep 3
  printf '/usage'
  sleep 0.3
  printf '\\x1b'  # Escape to dismiss autocomplete
  sleep 0.2
  printf '\\r'    # Carriage return to execute
  sleep 4
  printf '\\x1b'  # Escape to close usage dialog
  sleep 0.5
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
    // Write the script
    writeFileSync(scriptFile, interactiveScript, { mode: 0o755 });

    // Run the script
    const proc = spawn(["bash", scriptFile], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, TERM: "xterm-256color" },
    });

    // Wait for completion with timeout (script takes ~10s total)
    const timeoutPromise = sleep(20000).then(() => "timeout");
    const exitPromise = proc.exited.then(() => "done");
    const raceResult = await Promise.race([exitPromise, timeoutPromise]);

    if (raceResult === "timeout") {
      try {
        proc.kill();
      } catch {
        // Already dead
      }
    }

    // Give filesystem time to flush
    await sleep(300);

    // Read the output file
    let output = "";
    if (existsSync(tmpFile)) {
      output = readFileSync(tmpFile, "utf-8");
    }

    // Clean up temp files
    try {
      const { unlinkSync } = await import("fs");
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
      if (existsSync(scriptFile)) unlinkSync(scriptFile);
    } catch {
      // Ignore cleanup errors
    }

    if (output.includes("% used")) {
      return parseUsageOutput(output);
    }

    return null;
  } catch {
    // Clean up on error
    try {
      const { unlinkSync } = await import("fs");
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
      if (existsSync(scriptFile)) unlinkSync(scriptFile);
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

export async function getClaudeUsage(options: {
  refresh?: boolean;
  timeout?: number;
  noCache?: boolean;
} = {}): Promise<ClaudeUsage | null> {
  const { refresh = false, timeout = 30000, noCache = false } = options;

  // Try cache first unless refresh requested
  if (!refresh && !noCache) {
    const cached = getCachedUsage();
    if (cached) {
      return cached;
    }
  }

  // Find Claude binary
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    return null;
  }

  // Fetch usage from Claude
  const data = await fetchClaudeUsage(claudePath, timeout);

  if (data && !noCache) {
    saveCache(data);
  }

  return data;
}

export async function refreshUsageCache(): Promise<boolean> {
  const usage = await getClaudeUsage({ refresh: true });
  return usage !== null;
}

export function formatUsageBar(percentage: number | null, width: number = 30): string {
  if (percentage === null) return "░".repeat(width);

  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "░".repeat(empty);

  return bar;
}

export function formatUsage(usage: ClaudeUsage): string {
  const lines: string[] = [];

  const session = usage.session;
  if (session.percentage !== null) {
    const bar = formatUsageBar(session.percentage, 25);
    lines.push(`  Session:    ${bar} ${session.percentage.toString().padStart(3)}%`);
    if (session.resets_at) {
      lines.push(`              Resets ${session.resets_at}`);
    }
  }

  const week = usage.week_all_models;
  if (week.percentage !== null) {
    const bar = formatUsageBar(week.percentage, 25);
    lines.push(`  Week (all): ${bar} ${week.percentage.toString().padStart(3)}%`);
    if (week.resets_at) {
      lines.push(`              Resets ${week.resets_at}`);
    }
  }

  const sonnet = usage.week_sonnet;
  if (sonnet.percentage !== null) {
    const bar = formatUsageBar(sonnet.percentage, 25);
    lines.push(`  Sonnet:     ${bar} ${sonnet.percentage.toString().padStart(3)}%`);
  }

  if (usage.cached && usage.cache_age !== undefined) {
    lines.push(`  (cached ${usage.cache_age}s ago)`);
  }

  return lines.join("\n");
}
