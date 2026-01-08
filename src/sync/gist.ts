import { spawn } from "bun";
import {
  getLocalWindowsSince,
  getLocalHourlyUsageSince,
  importSyncedHourlyUsage,
  importSyncedWindows,
} from "../db/queries.ts";
import { getSyncConfig, updateSyncConfig, loadConfig, getMachineId, type OptimalStartTimes } from "../config/index.ts";
import { now } from "../utils/time.ts";
import { logError } from "../utils/errors.ts";
import { hostname } from "os";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../utils/paths.ts";

const GIST_FILENAME = "ccmax-sync.json";
const GIST_DESCRIPTION = "ccmax usage data sync";
const LOCAL_CACHE_FILE = join(DATA_DIR, "sync-cache.json");

/**
 * Saves sync data to local cache
 */
function saveSyncCache(data: SyncData): void {
  try {
    writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Loads sync data from local cache (no API call)
 */
export function loadSyncCache(): SyncData | null {
  try {
    if (existsSync(LOCAL_CACHE_FILE)) {
      return JSON.parse(readFileSync(LOCAL_CACHE_FILE, "utf-8")) as SyncData;
    }
  } catch {
    // Ignore cache read errors
  }
  return null;
}

export interface SyncData {
  version: number;
  updated_at: string;
  optimal_start_times?: OptimalStartTimes;
  optimal_start_times_updated_at?: string;
  machines: Record<string, MachineData>;
}

export interface MachineData {
  machine_id: string;
  hostname: string;
  last_update: string;
  windows: WindowData[];
  hourly_usage?: HourlyUsageData[];
}

export interface WindowData {
  window_start: string;
  window_end: string;
  active_minutes: number;
  utilization_pct: number;
  claude_usage_pct: number;
}

export interface HourlyUsageData {
  date_hour: string;
  usage_pct: number;
}

/**
 * Gets GitHub token from gh CLI
 */
export async function getGitHubToken(): Promise<string | null> {
  try {
    const proc = spawn(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0 && output.trim()) {
      return output.trim();
    }
  } catch (error) {
    logError("sync:getGitHubToken", error);
  }
  return null;
}

/**
 * Searches user's gists for an existing ccmax-sync.json file
 */
export async function findExistingGist(token: string): Promise<string | null> {
  try {
    // Fetch user's gists (paginated, check first 100)
    const response = await fetch("https://api.github.com/gists?per_page=100", {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "ccmax",
      },
    });

    if (!response.ok) {
      logError("sync:findExistingGist", new Error(`GitHub API error: ${response.status}`));
      return null;
    }

    const gists = await response.json() as Array<{ id: string; files: Record<string, unknown> }>;

    for (const gist of gists) {
      if (gist.files && GIST_FILENAME in gist.files) {
        return gist.id;
      }
    }

    return null;
  } catch (error) {
    logError("sync:findExistingGist", error);
    return null;
  }
}

/**
 * Creates a new gist for sync
 */
export async function createGist(token: string): Promise<string | null> {
  try {
    const initialData: SyncData = {
      version: 1,
      updated_at: now(),
      machines: {},
    };

    const response = await fetch("https://api.github.com/gists", {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ccmax",
      },
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify(initialData, null, 2),
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError("sync:createGist", new Error(`GitHub API error: ${response.status} ${error}`));
      return null;
    }

    const data = await response.json() as { id: string };
    return data.id;
  } catch (error) {
    logError("sync:createGist", error);
    return null;
  }
}

/**
 * Fetches sync data from gist
 */
export async function fetchGist(token: string, gistId: string): Promise<SyncData | null> {
  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "ccmax",
      },
    });

    if (!response.ok) {
      logError("sync:fetchGist", new Error(`GitHub API error: ${response.status}`));
      return null;
    }

    const data = await response.json() as { files: Record<string, { content: string }> };
    const file = data.files[GIST_FILENAME];

    if (!file) {
      logError("sync:fetchGist", new Error("Sync file not found in gist"));
      return null;
    }

    return JSON.parse(file.content) as SyncData;
  } catch (error) {
    logError("sync:fetchGist", error);
    return null;
  }
}

/**
 * Updates gist with new data
 */
export async function updateGist(token: string, gistId: string, data: SyncData): Promise<boolean> {
  try {
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      headers: {
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ccmax",
      },
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: {
            content: JSON.stringify(data, null, 2),
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError("sync:updateGist", new Error(`GitHub API error: ${response.status} ${error}`));
      return false;
    }

    return true;
  } catch (error) {
    logError("sync:updateGist", error);
    return false;
  }
}

// Re-export getMachineId for backwards compatibility
export { getMachineId } from "../config/index.ts";

/**
 * Gets local window data for sync (excludes synced data from other machines)
 */
export function getLocalWindowData(): WindowData[] {
  // Get local-only windows from past 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const windows = getLocalWindowsSince(thirtyDaysAgo.toISOString());

  return windows.map((w) => ({
    window_start: w.window_start,
    window_end: w.window_end,
    active_minutes: w.active_minutes,
    utilization_pct: w.utilization_pct,
    claude_usage_pct: w.claude_usage_pct || 0,
  }));
}

/**
 * Gets local hourly usage data for sync (last 48 hours, excludes synced data)
 */
export function getLocalHourlyUsageData(): HourlyUsageData[] {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const hourlyData = getLocalHourlyUsageSince(twoDaysAgo.toISOString());

  return hourlyData.map((h) => ({
    date_hour: h.date_hour,
    usage_pct: h.usage_pct,
  }));
}

/**
 * Computes a simple hash of data to detect changes
 */
function hashData(windows: WindowData[], hourlyUsage: HourlyUsageData[]): string {
  const windowStr = windows.map((w) => `${w.window_start}:${w.active_minutes}:${w.claude_usage_pct}`).join("|");
  const hourlyStr = hourlyUsage.map((h) => `${h.date_hour}:${h.usage_pct}`).join("|");
  const str = windowStr + "||" + hourlyStr;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Pushes local data to gist (fetch-merge-push to handle concurrent writes)
 */
export async function pushToGist(): Promise<{ success: boolean; message: string }> {
  const token = await getGitHubToken();
  if (!token) {
    return { success: false, message: "GitHub token not found. Run 'gh auth login' first." };
  }

  const config = getSyncConfig();
  if (!config.gist_id) {
    return { success: false, message: "Sync not configured. Run 'ccmax sync setup' first." };
  }

  const localWindows = getLocalWindowData();
  const localHourlyUsage = getLocalHourlyUsageData();

  // Check if there's anything to sync
  if (localWindows.length === 0 && localHourlyUsage.length === 0) {
    return { success: true, message: "Nothing to sync." };
  }

  // Check if data has changed since last sync
  const currentHash = hashData(localWindows, localHourlyUsage);
  if (config.last_sync_hash === currentHash) {
    return { success: true, message: "No changes to sync." };
  }

  // Fetch current gist data (to merge, not overwrite other machines)
  const syncData = await fetchGist(token, config.gist_id);
  if (!syncData) {
    return { success: false, message: "Failed to fetch sync data from gist." };
  }

  const machineId = getMachineId();

  // Only update our machine's data, preserving other machines
  syncData.machines[machineId] = {
    machine_id: machineId,
    hostname: hostname(),
    last_update: now(),
    windows: localWindows,
    hourly_usage: localHourlyUsage,
  };
  syncData.updated_at = now();

  // Sync optimal start times (last writer wins based on timestamp)
  const localConfig = loadConfig();
  const localOptimalTimes = localConfig.optimal_start_times;
  const hasLocalTimes = Object.values(localOptimalTimes).some((t) => t !== null);

  if (hasLocalTimes) {
    // Check if our times are newer or remote has none
    const remoteTimestamp = syncData.optimal_start_times_updated_at;
    const shouldUpdate = !remoteTimestamp || !syncData.optimal_start_times ||
      new Date(config.last_sync || 0) > new Date(remoteTimestamp);

    if (shouldUpdate) {
      syncData.optimal_start_times = localOptimalTimes;
      syncData.optimal_start_times_updated_at = now();
    }
  }

  const success = await updateGist(token, config.gist_id, syncData);
  if (success) {
    saveSyncCache(syncData);
    updateSyncConfig({ last_sync: now(), last_sync_hash: currentHash });
    return { success: true, message: `Pushed ${localWindows.length} windows, ${localHourlyUsage.length} hourly records to sync.` };
  }

  return { success: false, message: "Failed to update gist." };
}

/**
 * Pulls data from gist and merges into local database.
 * - Applies synced optimal_start_times to local config
 * - Imports usage data from other machines into local DB for learning
 */
export async function pullFromGist(): Promise<{ success: boolean; message: string; data?: SyncData }> {
  const token = await getGitHubToken();
  if (!token) {
    return { success: false, message: "GitHub token not found. Run 'gh auth login' first." };
  }

  const config = getSyncConfig();
  if (!config.gist_id) {
    return { success: false, message: "Sync not configured. Run 'ccmax sync setup' first." };
  }

  const syncData = await fetchGist(token, config.gist_id);
  if (!syncData) {
    return { success: false, message: "Failed to fetch sync data from gist." };
  }

  // Apply synced optimal_start_times if available
  if (syncData.optimal_start_times) {
    const { updateConfig } = await import("../config/index.ts");
    updateConfig({ optimal_start_times: syncData.optimal_start_times });
  }

  // Import usage data from other machines into local database
  const currentMachineId = getMachineId();
  let importedWindows = 0;
  let importedHourly = 0;
  let importedMachines = 0;

  for (const [machineId, machineData] of Object.entries(syncData.machines)) {
    // Skip our own machine's data
    if (machineId === currentMachineId) {
      continue;
    }

    // Import windows
    if (machineData.windows.length > 0) {
      importSyncedWindows(machineId, machineData.windows);
      importedWindows += machineData.windows.length;
    }

    // Import hourly usage
    if (machineData.hourly_usage && machineData.hourly_usage.length > 0) {
      importSyncedHourlyUsage(machineId, machineData.hourly_usage);
      importedHourly += machineData.hourly_usage.length;
    }

    if (machineData.windows.length > 0 || (machineData.hourly_usage && machineData.hourly_usage.length > 0)) {
      importedMachines++;
    }
  }

  saveSyncCache(syncData);

  const machineCount = Object.keys(syncData.machines).length;
  const totalWindows = Object.values(syncData.machines).reduce(
    (sum, m) => sum + m.windows.length,
    0
  );

  updateSyncConfig({ last_sync: now() });

  let importMsg = "";
  if (importedMachines > 0) {
    importMsg = ` Imported ${importedWindows} windows, ${importedHourly} hourly records from ${importedMachines} other machine(s).`;
  }

  return {
    success: true,
    message: `Pulled data from ${machineCount} machine(s), ${totalWindows} total windows.${importMsg}`,
    data: syncData,
  };
}

/**
 * Gets aggregate window data from all synced machines (from local cache)
 * For the current machine, uses fresh local data instead of stale cache
 */
export function getAggregateWindows(): WindowData[] | null {
  const syncData = loadSyncCache();
  if (!syncData) return null;

  const currentMachineId = getMachineId();
  const localWindows = getLocalWindowData();

  // Merge all windows from all machines, sorted by start time
  const allWindows: WindowData[] = [];
  for (const [machineId, machine] of Object.entries(syncData.machines)) {
    if (machineId === currentMachineId) {
      // Use fresh local data for current machine
      allWindows.push(...localWindows);
    } else {
      allWindows.push(...machine.windows);
    }
  }

  // Sort by window_start descending (newest first)
  allWindows.sort((a, b) => b.window_start.localeCompare(a.window_start));

  return allWindows;
}

export interface HourlyUsage {
  hour: number;
  max_usage: number;
}

/**
 * Gets aggregate hourly max usage from all synced machines (from local cache)
 * For the current machine, uses fresh local data instead of stale cache
 */
export function getAggregateHourlyUsage(since: string, until?: string): HourlyUsage[] | null {
  const syncData = loadSyncCache();
  if (!syncData) return null;

  const currentMachineId = getMachineId();
  const localHourlyUsage = getLocalHourlyUsageData();

  // Build date_hour strings for filtering
  const sinceDate = new Date(since);
  const sinceHour = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-${String(sinceDate.getDate()).padStart(2, '0')}-${String(sinceDate.getHours()).padStart(2, '0')}`;

  let untilHour: string | null = null;
  if (until) {
    const untilDate = new Date(until);
    untilHour = `${untilDate.getFullYear()}-${String(untilDate.getMonth() + 1).padStart(2, '0')}-${String(untilDate.getDate()).padStart(2, '0')}-${String(untilDate.getHours()).padStart(2, '0')}`;
  }

  // Collect hourly usage from all machines
  const hourlyMax = new Map<number, number>();
  for (const [machineId, machine] of Object.entries(syncData.machines)) {
    // Use fresh local data for current machine
    const hourlyData = machineId === currentMachineId ? localHourlyUsage : machine.hourly_usage;
    if (hourlyData) {
      for (const h of hourlyData) {
        if (h.date_hour >= sinceHour && (!untilHour || h.date_hour < untilHour)) {
          const hour = parseInt(h.date_hour.slice(-2), 10);
          const current = hourlyMax.get(hour) ?? 0;
          if (h.usage_pct > current) {
            hourlyMax.set(hour, h.usage_pct);
          }
        }
      }
    }
  }

  // Convert to array
  const result: HourlyUsage[] = [];
  for (const [hour, max_usage] of hourlyMax) {
    result.push({ hour, max_usage });
  }

  return result.sort((a, b) => a.hour - b.hour);
}

/**
 * Sets up sync with a new or existing gist
 */
export async function setupSync(existingGistId?: string): Promise<{ success: boolean; message: string }> {
  const token = await getGitHubToken();
  if (!token) {
    return { success: false, message: "GitHub token not found. Run 'gh auth login' first." };
  }

  let gistId: string | null = existingGistId || null;
  let usingExisting = false;

  if (gistId) {
    // Verify the gist exists and is accessible
    const data = await fetchGist(token, gistId);
    if (!data) {
      return { success: false, message: "Could not access the specified gist. Check the ID and permissions." };
    }
    usingExisting = true;
  } else {
    // Check for existing ccmax-sync.json gist first
    console.log("Checking for existing sync gist...");
    gistId = await findExistingGist(token);

    if (gistId) {
      usingExisting = true;
      console.log(`Found existing gist: ${gistId}`);
    } else {
      // Create a new gist
      console.log("No existing gist found, creating new one...");
      gistId = await createGist(token);
      if (!gistId) {
        return { success: false, message: "Failed to create gist." };
      }
    }
  }

  // Generate machine ID and save config
  const machineId = getMachineId();
  updateSyncConfig({ gist_id: gistId });

  // If using existing gist, pull data immediately
  let pullMessage = "";
  if (usingExisting) {
    const pullResult = await pullFromGist();
    if (pullResult.success) {
      pullMessage = `\n  ${pullResult.message}`;
    }
  }

  const action = usingExisting ? "Using existing gist" : "Created new gist";
  const nextStep = usingExisting
    ? "Run 'ccmax sync push' to upload this machine's data."
    : "Run 'ccmax sync push' to upload your data.";
  return {
    success: true,
    message: `Sync configured!\n  ${action}: ${gistId}\n  Machine ID: ${machineId}${pullMessage}\n\n${nextStep}`,
  };
}
