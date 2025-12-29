# Claude Code Max Window Maximizer - Implementation Plan

## Overview

A Bun CLI tool that tracks Claude Code usage patterns and optimizes 5-hour rolling window utilization for Claude Code Max subscribers.

## Problem Statement

Claude Code Max has 5-hour rolling usage windows (starting from your first prompt, resetting 5h later). Users often start sessions at suboptimal times, leading to:
- Wasted window time (starting a window, working for 1 hour, then needing to stop)
- Split work across multiple windows when it could fit in one
- Inconsistent usage patterns reducing productivity

## Solution

Track usage patterns, analyze them, and recommend/automate optimal session start times.

**Key behaviors:**
- On install, ask user how long they want to analyze before enabling auto-triggering (default: 7 days)
- Continuously monitor and adjust recommendations over time as habits change
- Never stop learning from usage patterns

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     claude-code-maximizer                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  CLI Tool    │  │   Daemon     │  │  Claude Hook     │  │
│  │              │  │              │  │                  │  │
│  │ - install    │  │ - monitors   │  │ - tracks usage   │  │
│  │ - status     │  │ - notifies   │  │ - logs events    │  │
│  │ - stats      │  │ - schedules  │  │ - window % track │  │
│  │ - analyze    │  │              │  │                  │  │
│  │ - config     │  │              │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                   │             │
│         └─────────────────┼───────────────────┘             │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐      │
│  │  SQLite DB   │  │ config.json  │  │  state.json  │      │
│  │  (usage.db)  │  │  (settings)  │  │  (runtime)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Claude Code Hook (`src/hook/`)

Claude Code supports hooks via `~/.claude/settings.json`. We'll create a hook that fires on:
- `PreToolUse` - tracks when tools are being invoked (indicates active usage)
- `PostToolUse` - tracks tool completion

**Hook responsibilities:**
- Log timestamps of Claude Code activity
- Write to local SQLite database
- Minimal overhead to not slow down Claude Code
- Track window usage percentage (parse `/usage` output or track independently)

**Window % tracking approach:**
- Option A: Parse output from Claude Code's `/usage` command periodically
- Option B: Track our own window start times and calculate % based on activity
- Recommend Option B for reliability (no dependency on Claude Code internals)

**Files:**
- `src/hook/handler.ts` - The hook script itself
- `src/hook/install.ts` - Installer that adds hook to `~/.claude/settings.json`

### 2. Data Store (`src/db/`)

**SQLite database** at `~/.claude-code-maximizer/usage.db` for time-series data.

**Schema:**
```sql
-- Raw usage events
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  timestamp TEXT NOT NULL,        -- ISO 8601 full timestamp
  event_type TEXT NOT NULL,       -- 'tool_start', 'tool_end'
  tool_name TEXT,                 -- Which tool was used
  session_id TEXT                 -- Group events by session
);

-- 5h usage windows (tracked independently)
CREATE TABLE usage_windows (
  id INTEGER PRIMARY KEY,
  window_start TEXT NOT NULL,     -- ISO 8601 full timestamp of window start
  window_end TEXT NOT NULL,       -- ISO 8601 full timestamp (window_start + 5h)
  active_minutes INTEGER,         -- Minutes of actual usage in this window
  utilization_pct REAL            -- active_minutes / 300 * 100
);

-- Index for efficient time-range queries
CREATE INDEX idx_events_timestamp ON usage_events(timestamp);
CREATE INDEX idx_windows_start ON usage_windows(window_start);
```

### 3. Configuration (`~/.claude-code-maximizer/`)

**config.json** - Human-readable settings:
```json
{
  "learning_period_days": 7,
  "notifications_enabled": true,
  "optimal_start_times": {
    "monday": "09:00",
    "tuesday": "09:00",
    "wednesday": "09:00",
    "thursday": "09:00",
    "friday": "09:00",
    "saturday": null,
    "sunday": null
  },
  "notification_advance_minutes": 5,
  "auto_adjust_enabled": true
}
```

**state.json** - Runtime state:
```json
{
  "installed_at": "2024-01-15T10:00:00Z",
  "learning_complete": false,
  "current_window_start": null,
  "daemon_pid": null
}
```

**Files:**
- `src/db/schema.ts` - Database schema and migrations
- `src/db/client.ts` - Database access layer
- `src/db/queries.ts` - Common queries
- `src/config/index.ts` - Config file management
- `src/config/state.ts` - Runtime state management

### 4. CLI Tool (`src/cli/`)

Main entry point: `ccmax` (or `claude-code-maximizer`)

**Commands:**

| Command              | Description                                             |
|----------------------|---------------------------------------------------------|
| `ccmax install`      | Install hook, run onboarding (ask learning period)      |
| `ccmax uninstall`    | Remove hook and optionally delete data                  |
| `ccmax status`       | Show tracking status, learning progress, current window |
| `ccmax stats`        | ASCII graph of usage over past day with 5h windows      |
| `ccmax analyze`      | Analyze patterns and show/update recommendations        |
| `ccmax daemon start` | Start the background daemon                             |
| `ccmax daemon stop`  | Stop the daemon                                         |
| `ccmax daemon status`| Check if daemon is running                              |
| `ccmax config`       | View/edit settings                                      |
| `ccmax export`       | Export usage data as JSON/CSV                           |

**Files:**
- `src/cli/index.ts` - Main CLI entry point
- `src/cli/commands/install.ts` - Install with interactive onboarding
- `src/cli/commands/uninstall.ts`
- `src/cli/commands/status.ts`
- `src/cli/commands/stats.ts` - ASCII usage graph
- `src/cli/commands/analyze.ts`
- `src/cli/commands/daemon.ts`
- `src/cli/commands/config.ts`
- `src/cli/commands/export.ts`

### 5. Stats Visualization (`src/stats/`)

ASCII-rendered graph for `ccmax stats`:

```
Usage over past 24 hours (5h windows shown)
═══════════════════════════════════════════════════════════════

     ┌─────────────────────────────────────────────────────────┐
100% │                    ████                                 │
 80% │                   ██████                                │
 60% │          ███      ███████                               │
 40% │         █████    █████████    ██                        │
 20% │    ██  ███████  ███████████  ████                       │
  0% │▁▁▁▁██▁▁████████▁████████████▁█████▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁│
     └─────────────────────────────────────────────────────────┘
      00   02   04   06   08   10   12   14   16   18   20   22

      ├────── Window 1 ──────┼────── Window 2 ──────┤
           09:00-14:00             14:00-19:00
           Usage: 78%              Usage: 45%

───────────────────────────────────────────────────────────────
 ccmax impact (since optimization started)
───────────────────────────────────────────────────────────────
 Windows avoided:     12 (saved ~60h of limit time)
 Avg utilization:     73% → 89% (+16%)
 Wasted time saved:   ~8.5h this month
```

**Files:**
- `src/stats/graph.ts` - ASCII graph rendering
- `src/stats/windows.ts` - Window visualization
- `src/stats/impact.ts` - Impact/savings calculations

### 6. Impact Tracking (`src/impact/`)

Track and calculate how much ccmax has helped the user.

**Metrics tracked:**

| Metric                    | Description                                                    |
|---------------------------|----------------------------------------------------------------|
| `windows_avoided`         | Windows that would have been triggered without optimization    |
| `utilization_before`      | Avg window utilization during learning period (baseline)       |
| `utilization_after`       | Avg window utilization after optimization started              |
| `wasted_time_saved`       | Hours saved by better window packing                           |
| `limit_hits_avoided`      | Times user would have hit limit mid-work                       |

**How we calculate "windows avoided":**

1. During learning period, record the user's "natural" behavior:
   - Average windows consumed per day
   - Average utilization per window
   - Frequency of poorly-timed window starts

2. After optimization starts, compare:
   - Actual windows used vs predicted (based on pre-optimization patterns)
   - Difference = windows avoided

**Schema addition:**
```sql
-- Impact tracking baselines and metrics
CREATE TABLE impact_metrics (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  windows_used INTEGER,                  -- Actual windows used this day
  windows_predicted INTEGER,             -- Windows we predicted without optimization
  avg_utilization REAL,                  -- Average utilization % this day
  is_optimized INTEGER DEFAULT 0         -- 0 = learning period, 1 = after optimization
);

-- Baseline stats from learning period
CREATE TABLE baseline_stats (
  key TEXT PRIMARY KEY,
  value REAL
);
-- Keys: avg_windows_per_day, avg_utilization, avg_wasted_minutes_per_window
```

**Files:**
- `src/impact/tracker.ts` - Record daily metrics
- `src/impact/baseline.ts` - Calculate and store learning period baseline
- `src/impact/calculator.ts` - Calculate savings vs baseline

### 7. Analyzer (`src/analyzer/`)

Processes usage data to determine and continuously update optimal window start times.

**Algorithm:**
1. Aggregate usage into 15-minute buckets across available data
2. Identify "work sessions" - periods of continuous usage with gaps < 30min
3. For each day of week, calculate typical work session patterns
4. Find optimal 5h window boundaries that:
   - Minimize the number of windows needed
   - Maximize utilization within windows
   - Account for day-of-week patterns
5. **Continuous adjustment**: Re-run analysis weekly, blend new recommendations with existing using exponential moving average

**Output:**
- Recommended daily start times (may vary by day of week)
- Confidence score based on data consistency
- Trend indicators (are patterns shifting?)

**Files:**
- `src/analyzer/aggregator.ts` - Aggregate raw events into sessions
- `src/analyzer/optimizer.ts` - Find optimal window start times
- `src/analyzer/patterns.ts` - Detect weekly patterns
- `src/analyzer/adaptive.ts` - Continuous adjustment logic

### 8. Daemon (`src/daemon/`)

Background process that runs and notifies users.

**Responsibilities:**
- Check if current time matches optimal session start
- Send desktop notification prompting user to start Claude Code
- Track whether user is already in a session (don't notify if active)
- Handle system sleep/wake events

**Platform support (v1: Linux only):**
- Linux: systemd user service
- macOS: planned for v2 (launchd plist)

**Notifications:**
- Linux: `notify-send` (libnotify)
- macOS (future): native `osascript` notifications

**Files:**
- `src/daemon/index.ts` - Main daemon process
- `src/daemon/notifier.ts` - Desktop notification system (Linux)
- `src/daemon/scheduler.ts` - Scheduling logic
- `src/daemon/service.ts` - systemd service management

---

## Implementation Phases

### Phase 1: Foundation & Data Collection
1. Set up Bun project with TypeScript
2. Implement SQLite database layer
3. Implement config/state JSON management
4. Create usage tracking hook
5. Implement `install` command with onboarding prompts
6. Implement `uninstall` command
7. Implement `status` command

### Phase 2: Stats & Visualization
1. Build ASCII graph rendering
2. Implement window tracking and visualization
3. Implement `stats` command
4. Set up impact tracking tables and baseline recording

### Phase 3: Analysis & Impact
1. Implement event aggregation
2. Build session detection algorithm
3. Create window optimization algorithm
4. Implement adaptive/continuous adjustment
5. Implement `analyze` command
6. Calculate baseline stats at end of learning period
7. Implement impact calculator (windows avoided, utilization improvement)
8. Add impact section to `stats` output

### Phase 4: Daemon & Notifications
1. Create daemon process
2. Implement Linux notifications (notify-send)
3. Create systemd user service management
4. Implement daemon commands

### Phase 5: Polish
1. Add `export` command
2. Add `config` command for editing settings
3. Improve error handling and edge cases
4. Write documentation

---

## Technical Decisions

### Why Bun?
- Fast startup time (critical for hooks - must not slow down Claude Code)
- Built-in SQLite support via `bun:sqlite`
- TypeScript-first
- Easy to bundle into single executable

### Why SQLite + JSON?
- SQLite for time-series data (efficient queries, reliable)
- JSON for config/state (human-readable, easy to edit manually)

### Hook Format
Claude Code hooks are configured in `~/.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "command",
        "command": "ccmax hook --event pre-tool --tool \"$CLAUDE_TOOL_NAME\""
      }
    ],
    "PostToolUse": [
      {
        "type": "command",
        "command": "ccmax hook --event post-tool --tool \"$CLAUDE_TOOL_NAME\""
      }
    ]
  }
}
```

### Rolling Window Logic
- Windows are 5h from when you send your first prompt
- Window resets 5h after it started
- We track window starts ourselves based on first activity after previous window expired

---

## File Structure

```
claude-code-maximizer/
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── install.ts
│   │       ├── uninstall.ts
│   │       ├── status.ts
│   │       ├── stats.ts
│   │       ├── analyze.ts
│   │       ├── daemon.ts
│   │       ├── config.ts
│   │       └── export.ts
│   ├── hook/
│   │   ├── handler.ts
│   │   └── install.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── client.ts
│   │   └── queries.ts
│   ├── config/
│   │   ├── index.ts
│   │   └── state.ts
│   ├── stats/
│   │   ├── graph.ts
│   │   ├── windows.ts
│   │   └── impact.ts
│   ├── analyzer/
│   │   ├── aggregator.ts
│   │   ├── optimizer.ts
│   │   ├── patterns.ts
│   │   └── adaptive.ts
│   ├── impact/
│   │   ├── tracker.ts
│   │   ├── baseline.ts
│   │   └── calculator.ts
│   ├── daemon/
│   │   ├── index.ts
│   │   ├── notifier.ts
│   │   ├── scheduler.ts
│   │   └── service.ts
│   └── utils/
│       └── time.ts
├── docs/
│   └── plans/
│       └── implementation-plan.md
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

---

## Key Algorithms

### Session Detection
```
Input: List of usage events sorted by timestamp
Output: List of sessions with start/end times

1. Initialize empty sessions list
2. For each event:
   a. If no current session OR gap > 30min:
      - Start new session
   b. Else:
      - Extend current session
3. Return sessions
```

### Window Optimization
```
Input: List of sessions with timestamps
Output: Recommended window start times per day

1. For each day of week:
   a. Collect all sessions for that day across available data
   b. Find the earliest and latest activity times
   c. Calculate total active time
   d. If total active time <= 5h:
      - Optimal start = earliest activity - 15min buffer
   e. If total active time > 5h:
      - Find natural break points to split into windows
      - Recommend start time that minimizes window count
2. Return schedule with per-day recommendations
```

### Adaptive Adjustment
```
Input: Current recommendations, new week of data
Output: Updated recommendations

1. Calculate new optimal times from recent data
2. If new recommendations differ significantly:
   a. Blend using exponential moving average (α=0.3)
   b. new_time = α * new_optimal + (1-α) * current
3. Update config.json with new times
4. Log adjustment for user visibility
```

### Impact Calculation
```
Input: Baseline stats (from learning period), current period stats
Output: Impact metrics for display

1. At end of learning period, snapshot baseline:
   - baseline_windows_per_day = avg windows used per day
   - baseline_utilization = avg % utilization per window
   - baseline_wasted_per_window = 300 - avg_active_minutes

2. For each day after optimization starts:
   a. windows_predicted = baseline_windows_per_day (adjusted for activity level)
   b. windows_avoided += max(0, windows_predicted - windows_used)
   c. utilization_delta = current_utilization - baseline_utilization

3. Calculate cumulative savings:
   - total_windows_avoided = sum of daily windows_avoided
   - hours_saved = total_windows_avoided * 5
   - wasted_time_saved = (baseline_wasted - current_wasted) * windows_used
   - utilization_improvement = avg(current_utilization) - baseline_utilization
```

---

## Onboarding Flow

When user runs `ccmax install`:

```
Welcome to Claude Code Maximizer!

This tool will help you optimize your Claude Code Max 5-hour windows.

How many days would you like to analyze before enabling auto-scheduling?
  [1] 3 days (quick start, less accurate)
  [2] 7 days (recommended)
  [3] 14 days (more accurate patterns)
  [4] Custom

> 2

Installing Claude Code hook... ✓
Creating data directory... ✓
Initializing database... ✓

Setup complete!

The tool will now track your usage patterns. After 7 days, run:
  ccmax analyze    - See your usage patterns
  ccmax daemon start - Enable automatic notifications

Check progress anytime with: ccmax status
```

---

## Platform Support

### v1 (Initial Release)
- **Linux only**
- systemd user service for daemon
- notify-send for notifications

### v2 (Future)
- **macOS support**
- launchd plist for daemon
- osascript for notifications

### Not Planned
- Windows (complexity not worth it for target audience)

---

## Privacy & Data

- All data stored locally in `~/.claude-code-maximizer/`
- No network requests ever
- User can export data anytime (`ccmax export`)
- User can delete all data (`ccmax uninstall --purge`)

---

## Implementation Status

_Last updated: 2024-12-28 (Phases 1-5 now complete)_

### Phase 1: Foundation & Data Collection — ✅ COMPLETE

| Task                                | Status | Notes                                              |
|-------------------------------------|--------|----------------------------------------------------|
| Set up Bun project with TypeScript  | ✅     | package.json, tsconfig.json configured             |
| Implement SQLite database layer     | ✅     | src/db/ with schema, client, queries               |
| Implement config/state JSON mgmt    | ✅     | src/config/ with index.ts, state.ts                |
| Create usage tracking hook          | ✅     | src/hook/ with handler.ts, install.ts              |
| Implement `install` command         | ✅     | Interactive onboarding (3/7/14 day options)        |
| Implement `uninstall` command       | ✅     | Supports --purge and --dry-run                     |
| Implement `status` command          | ✅     | Shows learning progress, window info, daemon state |

### Phase 2: Stats & Visualization — ✅ COMPLETE

| Task                                   | Status | Notes                                                   |
|----------------------------------------|--------|---------------------------------------------------------|
| Build ASCII graph rendering            | ✅     | Implemented in src/cli/commands/stats.ts (not separate) |
| Implement window tracking              | ✅     | Color-coded windows with utilization bars               |
| Implement `stats` command              | ✅     | 24h graph, window summary, impact metrics               |
| Set up impact tracking tables          | ✅     | impact_metrics, baseline_stats tables in schema         |
| Baseline recording                     | ✅     | calculateAndSaveBaseline() in analyze.ts                |

### Phase 3: Analysis & Impact — ✅ COMPLETE

| Task                                | Status | Notes                                                |
|-------------------------------------|--------|------------------------------------------------------|
| Implement event aggregation         | ✅     | src/analyzer/aggregator.ts                           |
| Build session detection algorithm   | ✅     | 30-min gap threshold, session grouping               |
| Create window optimization algo     | ✅     | src/analyzer/optimizer.ts                            |
| Adaptive/continuous adjustment      | ✅     | src/analyzer/adaptive.ts with EMA blending           |
| Implement `analyze` command         | ✅     | Weekly patterns, recommendations, --save flag        |
| Implement `adjust` command          | ✅     | Manual trigger for adaptive adjustment               |
| Calculate baseline stats            | ✅     | Automatic at end of learning period                  |
| Implement impact calculator         | ✅     | renderImpactStats() in stats.ts                      |
| Add impact section to `stats`       | ✅     | Shows windows avoided, utilization improvement       |

### Phase 4: Daemon & Notifications — ✅ COMPLETE

| Task                            | Status | Notes                                           |
|---------------------------------|--------|-------------------------------------------------|
| Create daemon process           | ✅     | src/daemon/index.ts with 60s check interval     |
| Implement Linux notifications   | ✅     | notify-send via src/daemon/notifier.ts          |
| Create systemd service mgmt     | ✅     | src/daemon/service.ts                           |
| Implement daemon commands       | ✅     | start/stop/status subcommands                   |

### Phase 5: Polish — ✅ COMPLETE

| Task                              | Status | Notes                                                 |
|-----------------------------------|--------|-------------------------------------------------------|
| Add `export` command              | ✅     | JSON and CSV formats, all data types                  |
| Add `config` command              | ✅     | View/set/reset, per-day optimal times                 |
| Improve error handling            | ✅     | src/utils/errors.ts, resilient hooks, db recovery     |
| Write documentation               | ✅     | Comprehensive README with all commands and usage      |

### File Structure Deviations

| Planned                       | Actual                                         | Reason                      |
|-------------------------------|------------------------------------------------|-----------------------------|
| src/stats/*.ts (3 files)      | src/cli/commands/stats.ts                      | Consolidated for simplicity |
| src/impact/*.ts (3 files)     | Merged into stats.ts and analyze.ts            | Consolidated for simplicity |
| src/analyzer/adaptive.ts      | src/analyzer/adaptive.ts ✅                    | Now implemented             |
| (none)                        | src/cli/commands/adjust.ts                     | Added for manual adjustment |
| (none)                        | src/utils/errors.ts                            | Added for error handling    |

### Outstanding Work

All major implementation phases are now complete. Remaining work:

1. **Test Suite** — See Test Plan below
   - No tests currently exist
   - E2E and unit tests need to be written

---

## Test Plan

### Test Infrastructure

Tests will use **Bun's built-in test runner** (`bun test`) for its speed and native TypeScript support.

#### Directory Structure

```
tests/
├── fixtures/
│   └── seed-db.ts          # Utility to seed test databases
├── helpers/
│   └── cli-runner.ts       # Execute ccmax CLI and capture output
├── e2e/
│   ├── install.test.ts
│   ├── status.test.ts
│   ├── stats.test.ts
│   ├── analyze.test.ts
│   ├── daemon.test.ts
│   ├── config.test.ts
│   ├── export.test.ts
│   └── hook.test.ts
└── unit/
    ├── aggregator.test.ts
    ├── optimizer.test.ts
    └── time-utils.test.ts
```

#### Test Helpers

**`tests/fixtures/seed-db.ts`**
```typescript
import { Database } from "bun:sqlite";
import { initializeSchema } from "../../src/db/schema";

export interface SeedEvent {
  timestamp: string;      // ISO 8601
  event_type: string;     // 'pre_tool', 'post_tool', 'prompt_submit'
  tool_name?: string;
  session_id?: string;
}

export interface SeedWindow {
  window_start: string;
  window_end: string;
  active_minutes: number;
  utilization_pct: number;
}

export function createTestDb(path: string): Database {
  const db = new Database(path);
  initializeSchema(db);
  return db;
}

export function seedEvents(db: Database, events: SeedEvent[]): void {
  const stmt = db.prepare(
    "INSERT INTO usage_events (timestamp, event_type, tool_name, session_id) VALUES (?, ?, ?, ?)"
  );
  for (const e of events) {
    stmt.run(e.timestamp, e.event_type, e.tool_name ?? null, e.session_id ?? null);
  }
}

export function seedWindows(db: Database, windows: SeedWindow[]): void {
  const stmt = db.prepare(
    "INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct) VALUES (?, ?, ?, ?)"
  );
  for (const w of windows) {
    stmt.run(w.window_start, w.window_end, w.active_minutes, w.utilization_pct);
  }
}

export function seedBaseline(db: Database, stats: Record<string, number>): void {
  const stmt = db.prepare("INSERT OR REPLACE INTO baseline_stats (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(stats)) {
    stmt.run(key, value);
  }
}

// Generate events simulating a work session
export function generateSessionEvents(
  startTime: Date,
  durationMinutes: number,
  intervalMinutes: number = 5
): SeedEvent[] {
  const events: SeedEvent[] = [];
  const sessionId = crypto.randomUUID();

  for (let m = 0; m < durationMinutes; m += intervalMinutes) {
    const timestamp = new Date(startTime.getTime() + m * 60 * 1000);
    events.push({
      timestamp: timestamp.toISOString(),
      event_type: "pre_tool",
      tool_name: "Read",
      session_id: sessionId,
    });
  }
  return events;
}
```

**`tests/helpers/cli-runner.ts`**
```typescript
import { spawn } from "bun";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCcmax(
  args: string[],
  env?: Record<string, string>
): Promise<CliResult> {
  const proc = spawn({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}
```

---

### End-to-End Test Cases

#### 1. Install Command Tests (`tests/e2e/install.test.ts`)

| Test Case                            | Setup                                          | Expected Outcome                                               |
|--------------------------------------|------------------------------------------------|----------------------------------------------------------------|
| Fresh install creates data directory | No ~/.claude-code-maximizer/                   | Directory created, config.json and state.json written          |
| Install initializes database         | Fresh install                                  | usage.db exists with correct schema                            |
| Install adds hook to settings.json   | ~/.claude/settings.json exists                 | Hook entries added to PreToolUse, PostToolUse                  |
| Install preserves existing hooks     | settings.json has other hooks                  | Existing hooks preserved, ccmax hooks added                    |
| Re-install is idempotent             | ccmax already installed                        | No duplicate hooks, no data loss                               |

```typescript
// Example test
test("install creates data directory and config files", async () => {
  const testHome = await mkdtemp("/tmp/ccmax-test-");
  const result = await runCcmax(["install", "--learning-period", "7"], {
    HOME: testHome,
    CCMAX_DATA_DIR: `${testHome}/.claude-code-maximizer`,
  });

  expect(result.exitCode).toBe(0);
  expect(await exists(`${testHome}/.claude-code-maximizer/config.json`)).toBe(true);
  expect(await exists(`${testHome}/.claude-code-maximizer/state.json`)).toBe(true);
  expect(await exists(`${testHome}/.claude-code-maximizer/usage.db`)).toBe(true);
});
```

#### 2. Status Command Tests (`tests/e2e/status.test.ts`)

| Test Case                              | Database State                                    | Expected Output                                      |
|----------------------------------------|---------------------------------------------------|------------------------------------------------------|
| Status shows "not installed"           | No state.json                                     | "ccmax is not installed"                             |
| Status shows learning progress         | installed_at 3 days ago, learning_period_days=7   | "Learning: Day 3 of 7 [████░░░░░░] 43%"              |
| Status shows learning complete         | learning_complete=true                            | "Learning complete. Run 'ccmax analyze'"             |
| Status shows current window            | Active window in usage_windows                    | Window times, utilization %, time remaining          |
| Status shows no active window          | No current window                                 | "No active window"                                   |
| Status shows daemon running            | daemon_pid set, process exists                    | "Daemon: Running (PID xxxxx)"                        |
| Status shows daemon not running        | daemon_pid null or stale                          | "Daemon: Not running"                                |

```typescript
test("status shows learning progress during learning period", async () => {
  // Setup: installed 3 days ago, 7-day learning period
  const stateJson = {
    installed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    learning_complete: false,
  };
  await writeState(testDir, stateJson);

  const result = await runCcmax(["status"], { CCMAX_DATA_DIR: testDir });

  expect(result.stdout).toContain("Learning: Day 3 of 7");
  expect(result.stdout).toMatch(/\[█{4}░{6}\]/); // Progress bar ~43%
});
```

#### 3. Stats Command Tests (`tests/e2e/stats.test.ts`)

| Test Case                              | Database State                                               | Expected Output                                     |
|----------------------------------------|--------------------------------------------------------------|-----------------------------------------------------|
| Stats with no data                     | Empty database                                               | "No data collected yet"                             |
| Stats shows hourly graph               | Events spread across 24h                                     | ASCII graph with bars at active hours               |
| Stats shows window summary             | 2 windows in past 24h                                        | Two window entries with times and utilization       |
| Stats shows color-coded windows        | Multiple overlapping windows                                 | Different colors for different windows              |
| Stats shows impact after optimization  | learning_complete=true, baseline + optimized metrics         | "Windows avoided: X", "Avg utilization: X% → Y%"    |
| Stats hides impact during learning     | learning_complete=false                                      | No impact section shown                             |

```typescript
test("stats displays hourly usage graph", async () => {
  const db = createTestDb(`${testDir}/usage.db`);

  // Seed events: heavy usage 9am-12pm, light usage 2pm-3pm
  const now = new Date();
  const today9am = new Date(now.setHours(9, 0, 0, 0));
  const today2pm = new Date(now.setHours(14, 0, 0, 0));

  seedEvents(db, [
    ...generateSessionEvents(today9am, 180),  // 3 hours
    ...generateSessionEvents(today2pm, 60),   // 1 hour
  ]);
  db.close();

  const result = await runCcmax(["stats"], { CCMAX_DATA_DIR: testDir });

  expect(result.stdout).toContain("Usage over past 24 hours");
  expect(result.stdout).toMatch(/[█▇▆▅▄▃▂▁]/);  // Has graph characters
  expect(result.exitCode).toBe(0);
});

test("stats shows window utilization summary", async () => {
  const db = createTestDb(`${testDir}/usage.db`);

  seedWindows(db, [
    {
      window_start: "2024-12-28T09:00:00Z",
      window_end: "2024-12-28T14:00:00Z",
      active_minutes: 180,
      utilization_pct: 60,
    },
    {
      window_start: "2024-12-28T14:30:00Z",
      window_end: "2024-12-28T19:30:00Z",
      active_minutes: 120,
      utilization_pct: 40,
    },
  ]);
  db.close();

  const result = await runCcmax(["stats"], { CCMAX_DATA_DIR: testDir });

  expect(result.stdout).toContain("Windows (past 24h):");
  expect(result.stdout).toContain("60%");
  expect(result.stdout).toContain("40%");
  expect(result.stdout).toContain("Average utilization: 50.0%");
});
```

#### 4. Analyze Command Tests (`tests/e2e/analyze.test.ts`)

| Test Case                                 | Database State                                             | Expected Output                                         |
|-------------------------------------------|------------------------------------------------------------|---------------------------------------------------------|
| Analyze with insufficient data            | 2 days since install, learning_period=7                    | "Not enough data yet. 5 days remaining"                 |
| Analyze with --force bypasses check       | 2 days since install                                       | Shows analysis results anyway                           |
| Analyze shows weekly patterns             | 7+ days of varied usage per weekday                        | "Most active day: X", per-day recommendations           |
| Analyze saves baseline on first run       | learning_complete=false, sufficient data                   | "Baseline statistics saved"                             |
| Analyze --save updates config             | After learning period                                      | optimal_start_times written to config.json              |
| Analyze shows confidence scores           | Data with varying consistency                              | "XX% confidence" for each day                           |

```typescript
test("analyze calculates weekly patterns from seed data", async () => {
  const db = createTestDb(`${testDir}/usage.db`);

  // Seed 2 weeks of data: work 9am-5pm Mon-Fri
  for (let week = 0; week < 2; week++) {
    for (let day = 1; day <= 5; day++) {  // Mon-Fri
      const date = new Date();
      date.setDate(date.getDate() - (week * 7 + (5 - day)));
      date.setHours(9, 0, 0, 0);
      seedEvents(db, generateSessionEvents(date, 480));  // 8 hours
    }
  }
  db.close();

  // Set state to indicate 14 days since install
  await writeState(testDir, {
    installed_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    learning_complete: false,
  });

  const result = await runCcmax(["analyze"], { CCMAX_DATA_DIR: testDir });

  expect(result.stdout).toContain("Weekly Usage Patterns");
  expect(result.stdout).toContain("Recommended Start Times");
  expect(result.stdout).toMatch(/Monday\s+\d{2}:\d{2}/);
  expect(result.stdout).toContain("Baseline statistics saved");
});

test("analyze --save writes optimal times to config", async () => {
  // ... setup with sufficient data ...

  await runCcmax(["analyze", "--save"], { CCMAX_DATA_DIR: testDir });

  const config = JSON.parse(await Bun.file(`${testDir}/config.json`).text());
  expect(config.optimal_start_times.monday).toMatch(/^\d{2}:\d{2}$/);
});
```

#### 5. Daemon Command Tests (`tests/e2e/daemon.test.ts`)

| Test Case                            | Setup                                           | Expected Outcome                                  |
|--------------------------------------|-------------------------------------------------|---------------------------------------------------|
| daemon start launches process        | Not running                                     | Process started, PID saved to state.json          |
| daemon start is idempotent           | Already running                                 | "Daemon is already running"                       |
| daemon stop kills process            | Running                                         | Process terminated, PID cleared                   |
| daemon stop when not running         | Not running                                     | "Daemon is not running"                           |
| daemon status shows running          | Running                                         | "Daemon: Running (PID xxxxx)"                     |
| daemon status shows not running      | Not running                                     | "Daemon: Not running"                             |

```typescript
test("daemon start creates background process", async () => {
  const result = await runCcmax(["daemon", "start"], { CCMAX_DATA_DIR: testDir });

  expect(result.stdout).toContain("Daemon started");

  const state = JSON.parse(await Bun.file(`${testDir}/state.json`).text());
  expect(state.daemon_pid).toBeGreaterThan(0);

  // Verify process exists
  const isRunning = await checkProcessExists(state.daemon_pid);
  expect(isRunning).toBe(true);

  // Cleanup
  process.kill(state.daemon_pid, "SIGTERM");
});
```

#### 6. Config Command Tests (`tests/e2e/config.test.ts`)

| Test Case                                | Input                                     | Expected Outcome                                   |
|------------------------------------------|-------------------------------------------|---------------------------------------------------|
| config shows all settings                | No args                                   | Displays full config.json contents                 |
| config get returns specific value        | `config get learning_period_days`         | "7"                                                |
| config set updates value                 | `config set learning_period_days 14`      | Config updated, confirmation shown                 |
| config set validates input               | `config set learning_period_days foo`     | Error: invalid value                               |
| config set optimal_start_times.monday    | `config set optimal_start_times.monday 09:30` | Nested value updated                           |
| config reset restores defaults           | `config reset`                            | Config reset to defaults                           |

```typescript
test("config set updates nested optimal_start_times", async () => {
  await runCcmax(["config", "set", "optimal_start_times.monday", "08:30"], {
    CCMAX_DATA_DIR: testDir,
  });

  const config = JSON.parse(await Bun.file(`${testDir}/config.json`).text());
  expect(config.optimal_start_times.monday).toBe("08:30");
});
```

#### 7. Export Command Tests (`tests/e2e/export.test.ts`)

| Test Case                            | Database State                                  | Expected Output                                |
|--------------------------------------|-------------------------------------------------|------------------------------------------------|
| export --format json                 | Events, windows, metrics seeded                 | Valid JSON with all data                       |
| export --format csv                  | Events, windows seeded                          | CSV files created                              |
| export events only                   | `export --type events`                          | Only events exported                           |
| export windows only                  | `export --type windows`                         | Only windows exported                          |
| export with date range               | `export --since 2024-12-01`                     | Only data after date                           |
| export empty database                | No data                                         | Empty array/no rows                            |

```typescript
test("export --format json includes all data types", async () => {
  const db = createTestDb(`${testDir}/usage.db`);
  seedEvents(db, generateSessionEvents(new Date(), 60));
  seedWindows(db, [{
    window_start: new Date().toISOString(),
    window_end: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    active_minutes: 60,
    utilization_pct: 20,
  }]);
  db.close();

  const result = await runCcmax(["export", "--format", "json"], {
    CCMAX_DATA_DIR: testDir,
  });

  const exported = JSON.parse(result.stdout);
  expect(exported.events).toBeArray();
  expect(exported.events.length).toBeGreaterThan(0);
  expect(exported.windows).toBeArray();
  expect(exported.windows.length).toBe(1);
});
```

#### 8. Hook Handler Tests (`tests/e2e/hook.test.ts`)

| Test Case                               | Input                                           | Expected Outcome                                  |
|-----------------------------------------|-------------------------------------------------|---------------------------------------------------|
| Hook inserts event on pre_tool          | `hook --event pre_tool --tool Read`             | Event row in usage_events                         |
| Hook inserts event on post_tool         | `hook --event post_tool --tool Edit`            | Event row in usage_events                         |
| Hook creates window on first activity   | No active window                                | New window created in usage_windows               |
| Hook updates window utilization         | Active window exists                            | active_minutes updated                            |
| Hook extends existing session           | Event within 30min of last                      | Same session_id used                              |
| Hook creates new session after gap      | Event 45min after last                          | New session_id generated                          |
| Hook is fast (latency test)             | Time hook execution                             | < 100ms execution time                            |

```typescript
test("hook creates new window on first activity", async () => {
  const db = createTestDb(`${testDir}/usage.db`);
  db.close();

  await runCcmax(["hook", "--event", "pre_tool", "--tool", "Read"], {
    CCMAX_DATA_DIR: testDir,
  });

  const db2 = new Database(`${testDir}/usage.db`);
  const windows = db2.query("SELECT * FROM usage_windows").all();
  expect(windows.length).toBe(1);
  db2.close();
});

test("hook execution completes in under 100ms", async () => {
  const start = performance.now();

  await runCcmax(["hook", "--event", "pre_tool", "--tool", "Read"], {
    CCMAX_DATA_DIR: testDir,
  });

  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(100);
});
```

---

### Unit Test Cases

#### Aggregator Tests (`tests/unit/aggregator.test.ts`)

| Test Case                                | Input                                            | Expected Output                             |
|------------------------------------------|--------------------------------------------------|---------------------------------------------|
| Detects sessions with 30min gap          | Events at 9:00, 9:05, 10:00 (55min gap)          | 2 sessions                                  |
| Merges events within gap threshold       | Events at 9:00, 9:10, 9:25                       | 1 session spanning 25min                    |
| Calculates hourly distribution           | Events spread across hours                       | Correct counts per hour                     |
| Handles empty event list                 | []                                               | Empty aggregation result                    |
| Groups by weekday correctly              | Events on Mon, Wed, Fri                          | 3 weekday entries in distribution           |

#### Optimizer Tests (`tests/unit/optimizer.test.ts`)

| Test Case                                | Input                                             | Expected Output                                  |
|------------------------------------------|---------------------------------------------------|--------------------------------------------------|
| Recommends start 15min before activity   | Sessions starting at 9:15 average                 | Recommended start: 09:00                         |
| Calculates expected utilization          | 3h of activity in typical day                     | ~60% expected utilization                        |
| Handles no data for a day                | No Saturday events                                | null recommendation for Saturday                 |
| Confidence based on data variance        | Consistent start times                            | High confidence (>80%)                           |
| Low confidence for inconsistent data     | Start times vary 7am-11am                         | Low confidence (<50%)                            |

#### Time Utils Tests (`tests/unit/time-utils.test.ts`)

| Test Case                                | Input                                             | Expected Output                                  |
|------------------------------------------|---------------------------------------------------|--------------------------------------------------|
| toISO formats Date correctly             | new Date("2024-12-28T09:00:00Z")                  | "2024-12-28T09:00:00.000Z"                       |
| fromISO parses ISO string                | "2024-12-28T09:00:00Z"                            | Date object with correct time                    |
| formatTime shows HH:MM                   | Date at 9:05am                                    | "09:05"                                          |
| addMinutes calculates correctly          | Date + 300 minutes                                | Date 5 hours later                               |
| WINDOW_DURATION_MINUTES is 300           | -                                                 | 300                                              |

---

### Test Data Scenarios

#### Scenario 1: New User (Learning Period)

```typescript
// Simulates a user in their first week
const scenario = {
  installed_at: "3 days ago",
  learning_complete: false,
  events: "Light usage, 2-3 hours per day",
  windows: "2-3 windows with 30-50% utilization",
  baseline: {},
};
```

#### Scenario 2: Post-Learning (Optimized)

```typescript
// Simulates user after learning period with optimization active
const scenario = {
  installed_at: "14 days ago",
  learning_complete: true,
  events: "Consistent 8am-6pm usage on weekdays",
  windows: "1-2 windows per day with 70-90% utilization",
  baseline: {
    avg_windows_per_day: 2.5,
    avg_utilization: 45,
    avg_wasted_minutes_per_window: 165,
  },
  impact_metrics: "Shows improvement vs baseline",
};
```

#### Scenario 3: Irregular Usage

```typescript
// Simulates user with inconsistent patterns
const scenario = {
  events: "Random hours, weekends included",
  expected: "Low confidence scores, generic recommendations",
};
```

---

### Running Tests

Add to package.json:

```json
{
  "scripts": {
    "test": "bun test",
    "test:e2e": "bun test tests/e2e",
    "test:unit": "bun test tests/unit",
    "test:coverage": "bun test --coverage"
  }
}
```

Run all tests:
```bash
bun test
```

Run specific test file:
```bash
bun test tests/e2e/stats.test.ts
```

Run with verbose output:
```bash
bun test --verbose
```

---

### Test Environment Setup

Each test should:

1. Create an isolated temp directory for CCMAX_DATA_DIR
2. Initialize a fresh database with seed data
3. Run CLI commands against the isolated environment
4. Clean up temp directory after test

```typescript
import { beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "ccmax-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

