import { getDb } from "./client.ts";
import { now, formatDate, WINDOW_DURATION_MINUTES } from "../utils/time.ts";
import { getMachineId } from "../config/index.ts";

// Types
export interface UsageWindow {
  id: number;
  window_start: string;
  window_end: string;
  active_minutes: number;
  utilization_pct: number;
  claude_usage_pct: number;
}

export interface ImpactMetric {
  id: number;
  date: string;
  windows_used: number;
  windows_predicted: number;
  avg_utilization: number;
  is_optimized: number;
}

// Hourly Usage
export interface HourlyUsage {
  hour: number;
  max_usage: number;
}

export function getHourlyMaxUsage(since: string): HourlyUsage[] {
  const db = getDb();
  const sinceDate = new Date(since);
  const sinceHour = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-${String(sinceDate.getDate()).padStart(2, '0')}-${String(sinceDate.getHours()).padStart(2, '0')}`;

  return db
    .query<HourlyUsage, [string]>(
      `SELECT
        CAST(substr(date_hour, 12, 2) AS INTEGER) as hour,
        usage_pct as max_usage
       FROM hourly_usage
       WHERE date_hour >= ?
       ORDER BY date_hour`
    )
    .all(sinceHour);
}

export function upsertHourlyUsage(usagePct: number): void {
  const db = getDb();
  const currentTime = new Date();
  const dateHour = `${currentTime.getFullYear()}-${String(currentTime.getMonth() + 1).padStart(2, '0')}-${String(currentTime.getDate()).padStart(2, '0')}-${String(currentTime.getHours()).padStart(2, '0')}`;
  const timestamp = currentTime.toISOString();
  const machineId = getMachineId();

  db.run(
    `INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date_hour, machine_id) DO UPDATE SET
       usage_pct = MAX(usage_pct, excluded.usage_pct),
       updated_at = excluded.updated_at`,
    [dateHour, usagePct, timestamp, machineId]
  );
}

export interface HourlyUsageRecord {
  date_hour: string;
  usage_pct: number;
  updated_at: string;
}

export function getHourlyUsageSince(since: string): HourlyUsageRecord[] {
  const db = getDb();
  const sinceDate = new Date(since);
  const sinceHour = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-${String(sinceDate.getDate()).padStart(2, '0')}-${String(sinceDate.getHours()).padStart(2, '0')}`;

  // Returns all data (local + synced) for learning/analysis
  return db
    .query<HourlyUsageRecord, [string]>(
      "SELECT date_hour, usage_pct, updated_at FROM hourly_usage WHERE date_hour >= ? ORDER BY date_hour"
    )
    .all(sinceHour);
}

/**
 * Gets local-only hourly usage since a given date (excludes synced data).
 * Used for pushing to gist.
 */
export function getLocalHourlyUsageSince(since: string): HourlyUsageRecord[] {
  const db = getDb();
  const sinceDate = new Date(since);
  const sinceHour = `${sinceDate.getFullYear()}-${String(sinceDate.getMonth() + 1).padStart(2, '0')}-${String(sinceDate.getDate()).padStart(2, '0')}-${String(sinceDate.getHours()).padStart(2, '0')}`;
  const machineId = getMachineId();

  return db
    .query<HourlyUsageRecord, [string, string]>(
      "SELECT date_hour, usage_pct, updated_at FROM hourly_usage WHERE date_hour >= ? AND machine_id = ? ORDER BY date_hour"
    )
    .all(sinceHour, machineId);
}

export function getHourlyMaxUsageInRange(start: string, end: string): HourlyUsage[] {
  const db = getDb();
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startHour = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}-${String(startDate.getHours()).padStart(2, '0')}`;
  const endHour = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}-${String(endDate.getHours()).padStart(2, '0')}`;

  return db
    .query<HourlyUsage, [string, string]>(
      `SELECT
        CAST(substr(date_hour, 12, 2) AS INTEGER) as hour,
        usage_pct as max_usage
       FROM hourly_usage
       WHERE date_hour >= ? AND date_hour < ?
       ORDER BY date_hour`
    )
    .all(startHour, endHour);
}

export function getHourlyUsageCount(): number {
  const db = getDb();
  const row = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM hourly_usage")
    .get();
  return row?.count ?? 0;
}

export function clearHourlyUsage(): void {
  const db = getDb();
  db.run("DELETE FROM hourly_usage");
}

// Usage Windows
export function createWindow(windowStart: string, windowEnd: string): number {
  const db = getDb();
  const machineId = getMachineId();
  db.run(
    "INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, machine_id) VALUES (?, ?, 0, 0, ?)",
    [windowStart, windowEnd, machineId]
  );
  const row = db
    .query<{ id: number }, []>("SELECT last_insert_rowid() as id")
    .get();
  return row?.id ?? 0;
}

export function updateWindowUtilization(
  windowId: number,
  activeMinutes: number,
  claudeUsagePct?: number
): void {
  const db = getDb();
  const utilizationPct = (activeMinutes / WINDOW_DURATION_MINUTES) * 100;
  if (claudeUsagePct !== undefined) {
    db.run(
      "UPDATE usage_windows SET active_minutes = ?, utilization_pct = ?, claude_usage_pct = ? WHERE id = ?",
      [activeMinutes, utilizationPct, claudeUsagePct, windowId]
    );
  } else {
    db.run(
      "UPDATE usage_windows SET active_minutes = ?, utilization_pct = ? WHERE id = ?",
      [activeMinutes, utilizationPct, windowId]
    );
  }
}

export function updateWindowEnd(windowId: number, windowEnd: string): void {
  const db = getDb();
  db.run("UPDATE usage_windows SET window_end = ? WHERE id = ?", [
    windowEnd,
    windowId,
  ]);
}

export function getCurrentWindow(): UsageWindow | null {
  const db = getDb();
  const currentTime = now();
  return db
    .query<UsageWindow, [string, string]>(
      "SELECT * FROM usage_windows WHERE window_start <= ? AND window_end > ? ORDER BY window_start DESC LIMIT 1"
    )
    .get(currentTime, currentTime);
}

export function getWindowsSince(since: string): UsageWindow[] {
  const db = getDb();
  // Returns all windows (local + synced) for learning/analysis
  return db
    .query<UsageWindow, [string]>(
      "SELECT id, window_start, window_end, active_minutes, utilization_pct, claude_usage_pct FROM usage_windows WHERE window_start >= ? ORDER BY window_start ASC"
    )
    .all(since);
}

/**
 * Gets local-only windows since a given date (excludes synced data).
 * Used for pushing to gist.
 */
export function getLocalWindowsSince(since: string): UsageWindow[] {
  const db = getDb();
  const machineId = getMachineId();
  return db
    .query<UsageWindow, [string, string]>(
      "SELECT id, window_start, window_end, active_minutes, utilization_pct, claude_usage_pct FROM usage_windows WHERE window_start >= ? AND machine_id = ? ORDER BY window_start ASC"
    )
    .all(since, machineId);
}

export function getWindowsInRange(start: string, end: string): UsageWindow[] {
  const db = getDb();
  return db
    .query<UsageWindow, [string, string]>(
      "SELECT * FROM usage_windows WHERE window_start >= ? AND window_start < ? ORDER BY window_start ASC"
    )
    .all(start, end);
}

export function getWindowCount(): number {
  const db = getDb();
  const row = db
    .query<{ count: number }, []>("SELECT COUNT(*) as count FROM usage_windows")
    .get();
  return row?.count ?? 0;
}

// Impact Metrics
export function upsertImpactMetric(
  date: string,
  windowsUsed: number,
  windowsPredicted: number,
  avgUtilization: number,
  isOptimized: boolean
): void {
  const db = getDb();
  db.run(
    `INSERT INTO impact_metrics (date, windows_used, windows_predicted, avg_utilization, is_optimized)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       windows_used = excluded.windows_used,
       windows_predicted = excluded.windows_predicted,
       avg_utilization = excluded.avg_utilization,
       is_optimized = excluded.is_optimized`,
    [date, windowsUsed, windowsPredicted, avgUtilization, isOptimized ? 1 : 0]
  );
}

export function getImpactMetrics(since: string): ImpactMetric[] {
  const db = getDb();
  return db
    .query<ImpactMetric, [string]>(
      "SELECT * FROM impact_metrics WHERE date >= ? ORDER BY date ASC"
    )
    .all(since);
}

export function getOptimizedMetrics(): ImpactMetric[] {
  const db = getDb();
  return db
    .query<ImpactMetric, []>(
      "SELECT * FROM impact_metrics WHERE is_optimized = 1 ORDER BY date ASC"
    )
    .all();
}

export function getTodayMetric(): ImpactMetric | null {
  const db = getDb();
  const today = formatDate(new Date());
  return db
    .query<ImpactMetric, [string]>(
      "SELECT * FROM impact_metrics WHERE date = ?"
    )
    .get(today);
}

// Baseline Stats
export function setBaselineStat(key: string, value: number): void {
  const db = getDb();
  db.run(
    "INSERT OR REPLACE INTO baseline_stats (key, value) VALUES (?, ?)",
    [key, value]
  );
}

export function getBaselineStat(key: string): number | null {
  const db = getDb();
  const row = db
    .query<{ value: number }, [string]>(
      "SELECT value FROM baseline_stats WHERE key = ?"
    )
    .get(key);
  return row?.value ?? null;
}

export function getAllBaselineStats(): Record<string, number> {
  const db = getDb();
  const rows = db
    .query<{ key: string; value: number }, []>("SELECT key, value FROM baseline_stats")
    .all();
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// Sync Import Functions

export interface SyncedHourlyUsage {
  date_hour: string;
  usage_pct: number;
}

export interface SyncedWindow {
  window_start: string;
  window_end: string;
  active_minutes: number;
  utilization_pct: number;
  claude_usage_pct: number;
}

/**
 * Imports hourly usage data from a synced machine.
 * Replaces all existing data for that machine_id.
 */
export function importSyncedHourlyUsage(machineId: string, records: SyncedHourlyUsage[]): void {
  const db = getDb();
  const timestamp = now();

  // Delete existing data for this machine
  db.run("DELETE FROM hourly_usage WHERE machine_id = ?", [machineId]);

  // Insert new data
  const stmt = db.prepare(
    "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)"
  );

  for (const record of records) {
    stmt.run(record.date_hour, record.usage_pct, timestamp, machineId);
  }
}

/**
 * Imports usage windows from a synced machine.
 * Replaces all existing windows for that machine_id.
 */
export function importSyncedWindows(machineId: string, windows: SyncedWindow[]): void {
  const db = getDb();

  // Delete existing windows for this machine
  db.run("DELETE FROM usage_windows WHERE machine_id = ?", [machineId]);

  // Insert new windows
  const stmt = db.prepare(
    `INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct, machine_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const w of windows) {
    stmt.run(w.window_start, w.window_end, w.active_minutes, w.utilization_pct, w.claude_usage_pct, machineId);
  }
}

/**
 * Removes all synced data for a specific machine.
 */
export function removeSyncedMachine(machineId: string): void {
  const db = getDb();
  db.run("DELETE FROM hourly_usage WHERE machine_id = ?", [machineId]);
  db.run("DELETE FROM usage_windows WHERE machine_id = ?", [machineId]);
}

/**
 * Gets all machine IDs that have synced data in the database.
 */
export function getSyncedMachineIds(): string[] {
  const db = getDb();
  const hourlyMachines = db
    .query<{ machine_id: string }, []>(
      "SELECT DISTINCT machine_id FROM hourly_usage WHERE machine_id IS NOT NULL"
    )
    .all();
  const windowMachines = db
    .query<{ machine_id: string }, []>(
      "SELECT DISTINCT machine_id FROM usage_windows WHERE machine_id IS NOT NULL"
    )
    .all();

  const machineSet = new Set<string>();
  for (const m of hourlyMachines) machineSet.add(m.machine_id);
  for (const m of windowMachines) machineSet.add(m.machine_id);

  return Array.from(machineSet);
}

/**
 * Gets count of local hourly usage records only (excludes synced data).
 */
export function getLocalHourlyUsageCount(): number {
  const db = getDb();
  const machineId = getMachineId();
  const row = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM hourly_usage WHERE machine_id = ?")
    .get(machineId);
  return row?.count ?? 0;
}

/**
 * Gets count of local windows only (excludes synced data).
 */
export function getLocalWindowCount(): number {
  const db = getDb();
  const machineId = getMachineId();
  const row = db
    .query<{ count: number }, [string]>("SELECT COUNT(*) as count FROM usage_windows WHERE machine_id = ?")
    .get(machineId);
  return row?.count ?? 0;
}
