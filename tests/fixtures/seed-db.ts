import { Database } from "bun:sqlite";
import { initializeSchema } from "../../src/db/schema.ts";

/**
 * Fluent builder for creating and populating test databases.
 *
 * @example
 * ```ts
 * testDb(path)
 *   .hourly(10, 50)           // hour 10, 50% usage (today)
 *   .hourly(14, 80)           // hour 14, 80% usage (today)
 *   .window("09:00", "14:00", { active: 120, usage: 40 })
 *   .baseline({ avg_utilization: 60 })
 *   .done();
 * ```
 */
export class TestDbBuilder {
  private db: Database;
  private _today: Date;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    initializeSchema(this.db);
    this._today = new Date();
    this._today.setHours(0, 0, 0, 0);
  }

  /** Get today's date (midnight) */
  get today(): Date {
    return new Date(this._today);
  }

  /** Get yesterday's date (midnight) */
  get yesterday(): Date {
    const d = new Date(this._today);
    d.setDate(d.getDate() - 1);
    return d;
  }

  /** Get a date N days ago (midnight) */
  daysAgo(n: number): Date {
    const d = new Date(this._today);
    d.setDate(d.getDate() - n);
    return d;
  }

  /** Get tomorrow's date (midnight) */
  get tomorrow(): Date {
    const d = new Date(this._today);
    d.setDate(d.getDate() + 1);
    return d;
  }

  /** Get a date N days ahead (midnight) */
  daysAhead(n: number): Date {
    const d = new Date(this._today);
    d.setDate(d.getDate() + n);
    return d;
  }

  /**
   * Insert hourly usage record.
   * @param hour - Hour of day (0-23)
   * @param usage - Usage percentage (0-100)
   * @param date - Optional date (defaults to today)
   */
  hourly(hour: number, usage: number, date?: Date): this {
    const d = date ?? this._today;
    const dateHour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(hour).padStart(2, "0")}`;
    const timestamp = new Date(d);
    timestamp.setHours(hour);

    this.db.run(
      "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at) VALUES (?, ?, ?)",
      [dateHour, usage, timestamp.toISOString()]
    );
    return this;
  }

  /**
   * Insert a usage window.
   * @param start - Start time as "HH:MM"
   * @param end - End time as "HH:MM"
   * @param opts - Options: active (minutes), usage (%), date
   */
  window(start: string, end: string, opts: { active: number; usage?: number; date?: Date }): this {
    const date = opts.date ?? this._today;
    const windowStart = this.timeToISO(start, date);
    const windowEnd = this.timeToISO(end, date);
    const utilization = (opts.active / 300) * 100;

    this.db.run(
      "INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct) VALUES (?, ?, ?, ?, ?)",
      [windowStart, windowEnd, opts.active, utilization, opts.usage ?? 0]
    );
    return this;
  }

  /**
   * Insert baseline stats.
   */
  baseline(stats: Record<string, number>): this {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO baseline_stats (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(stats)) {
      stmt.run(key, value);
    }
    return this;
  }

  /**
   * Insert impact metrics.
   */
  impact(opts: {
    date?: string;
    windowsUsed: number;
    windowsPredicted: number;
    avgUtilization: number;
    isOptimized?: boolean;
  }): this {
    const date = opts.date ?? this._today.toISOString().split("T")[0]!;
    this.db.run(
      "INSERT INTO impact_metrics (date, windows_used, windows_predicted, avg_utilization, is_optimized) VALUES (?, ?, ?, ?, ?)",
      [date, opts.windowsUsed, opts.windowsPredicted, opts.avgUtilization, opts.isOptimized ? 1 : 0]
    );
    return this;
  }

  /**
   * Get the underlying database for advanced operations.
   */
  raw(): Database {
    return this.db;
  }

  /**
   * Close the database and finish building.
   */
  done(): void {
    this.db.close();
  }

  private timeToISO(time: string, date: Date): string {
    const [hours, minutes] = time.split(":").map(Number);
    const d = new Date(date);
    d.setHours(hours!, minutes!, 0, 0);
    return d.toISOString();
  }
}

/**
 * Create a test database with fluent API.
 */
export function testDb(path: string): TestDbBuilder {
  return new TestDbBuilder(path);
}

// ============================================================================
// Query Helpers (for test assertions)
// ============================================================================

export interface WindowRecord {
  id: number;
  window_start: string;
  window_end: string;
  active_minutes: number;
  utilization_pct: number;
  claude_usage_pct: number;
}

export interface HourlyRecord {
  date_hour: string;
  usage_pct: number;
  updated_at: string;
}

/**
 * Query windows from a test database.
 */
export function queryWindows(dbPath: string): WindowRecord[] {
  const db = new Database(dbPath);
  const rows = db.query<WindowRecord, []>("SELECT * FROM usage_windows ORDER BY window_start ASC").all();
  db.close();
  return rows;
}

/**
 * Query hourly usage from a test database.
 */
export function queryHourly(dbPath: string): HourlyRecord[] {
  const db = new Database(dbPath);
  const rows = db.query<HourlyRecord, []>("SELECT * FROM hourly_usage ORDER BY date_hour ASC").all();
  db.close();
  return rows;
}

// ============================================================================
// Data Generators (for bulk test data)
// ============================================================================

/**
 * Generate hourly usage for a week of work days.
 * Useful for analyze/adjust tests that need realistic patterns.
 */
export function generateWeeklyUsage(
  builder: TestDbBuilder,
  opts: {
    hoursPerDay?: number;
    startHour?: number;
    avgUsage?: number;
  } = {}
): TestDbBuilder {
  const { hoursPerDay = 6, startHour = 9, avgUsage = 50 } = opts;

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(builder.today);
    date.setDate(date.getDate() - dayOffset);

    // Skip weekends
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    for (let h = 0; h < hoursPerDay; h++) {
      const usage = avgUsage + Math.floor(Math.random() * 30);
      builder.hourly(startHour + h, usage, date);
    }
  }

  return builder;
}

/**
 * Generate multiple windows.
 */
export function generateWindows(
  builder: TestDbBuilder,
  count: number,
  opts: { avgActive?: number } = {}
): TestDbBuilder {
  const { avgActive = 150 } = opts;

  for (let i = 0; i < count; i++) {
    const date = new Date(builder.today);
    date.setDate(date.getDate() - Math.floor(i / 2));

    const startHour = 9 + (i % 2) * 6;
    const variance = Math.floor((Math.random() - 0.5) * 60);
    const active = Math.max(30, Math.min(290, avgActive + variance));

    builder.window(
      `${String(startHour).padStart(2, "0")}:00`,
      `${String(startHour + 5).padStart(2, "0")}:00`,
      { active, date }
    );
  }

  return builder;
}
