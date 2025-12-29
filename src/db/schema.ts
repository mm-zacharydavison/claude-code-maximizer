import { Database } from "bun:sqlite";

const SCHEMA = `
-- Hourly max usage for graph
CREATE TABLE IF NOT EXISTS hourly_usage (
  date_hour TEXT PRIMARY KEY,
  usage_pct REAL NOT NULL,
  updated_at TEXT NOT NULL
);

-- 5h usage windows
CREATE TABLE IF NOT EXISTS usage_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  active_minutes INTEGER DEFAULT 0,
  utilization_pct REAL DEFAULT 0,
  claude_usage_pct REAL DEFAULT 0
);

-- Impact tracking metrics
CREATE TABLE IF NOT EXISTS impact_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  windows_used INTEGER DEFAULT 0,
  windows_predicted INTEGER DEFAULT 0,
  avg_utilization REAL DEFAULT 0,
  is_optimized INTEGER DEFAULT 0
);

-- Baseline stats from learning period
CREATE TABLE IF NOT EXISTS baseline_stats (
  key TEXT PRIMARY KEY,
  value REAL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_windows_start ON usage_windows(window_start);
CREATE INDEX IF NOT EXISTS idx_impact_date ON impact_metrics(date);
`;

export function initializeSchema(db: Database): void {
  db.exec(SCHEMA);
}
