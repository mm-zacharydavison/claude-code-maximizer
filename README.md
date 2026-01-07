# ccmax - Claude Code Max Window Maximizer

A CLI tool that tracks your Claude Code usage patterns and helps you optimize your 5-hour rolling windows for maximum productivity.

## The Problem

Claude Code Max has 5-hour rolling usage windows. Your window starts when you send your first prompt and resets 5 hours later. Users often start sessions at suboptimal times, leading to:

- **Wasted window time** - Starting a window, working for 1 hour, then needing to stop
- **Split work** - Tasks that could fit in one window get spread across multiple
- **Inconsistent patterns** - No visibility into when you're most productive

## The Solution

**ccmax** learns your usage patterns during a learning period, then:
1. Recommends optimal times to start your Claude Code sessions
2. Sends desktop notifications at those optimal times
3. Continuously adapts recommendations as your patterns change
4. Shows you how much time you've saved with impact metrics

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime
- Linux (macOS support planned)
- Claude Code with Max subscription

### Install

```bash
npx claude-code-maximizer install
```

The installer will:
- Copy the binary to `~/.local/bin/ccmax`
- Add usage tracking hooks to `~/.claude/settings.json`
- Create the data directory at `~/.claude-code-maximizer/`
- Ask you to choose a learning period (3, 7, or 14 days)

Make sure `~/.local/bin` is in your PATH:
```bash
# Add to your ~/.bashrc or ~/.zshrc
export PATH="$HOME/.local/bin:$PATH"
```

## Quick Start

```bash
# 1. Install (interactive)
ccmax install

# 2. Use Claude Code normally during learning period
#    (ccmax tracks your usage in the background)

# 3. Check progress
ccmax status

# 4. After learning period, analyze and save recommendations
ccmax analyze --save

# 5. Start the notification daemon
ccmax daemon start
```

## Commands

| Command          | Description                                                |
|------------------|------------------------------------------------------------|
| `install`        | Install hooks and set up tracking                          |
| `uninstall`      | Remove hooks (use `--purge` to delete all data)            |
| `status`         | Show tracking status and learning progress                 |
| `usage`          | Show Claude rate limit usage (from Claude CLI)             |
| `stats`          | Show usage graph with impact metrics                       |
| `analyze`        | Analyze patterns and show recommendations                  |
| `adjust`         | Adaptively adjust optimal times based on recent patterns   |
| `daemon`         | Manage the background notification daemon                  |
| `config`         | View and modify configuration                              |
| `export`         | Export usage data to JSON or CSV                           |

### Command Details

#### `ccmax status`

Shows your current tracking status:
- Learning progress (Day X of Y)
- Current 5-hour window info (if active)
- Daemon running status
- Event count

```
Learning: Day 5 of 7 [████████░░░░░░░░░░░░] 71%
Current window: 09:15 - 14:15 (2h 30m remaining)
Daemon: Running (PID 12345)
Events tracked: 847
```

#### `ccmax stats`

Displays an ASCII graph of your usage over the past 24 hours with color-coded windows:

```
Usage over past 24 hours
══════════════════════════════════════════════════════════════

     ┌────────────────────────────────────────────────┐
100% │                    ████                         │
 80% │                   ██████                        │
 60% │          ███      ███████                       │
 40% │         █████    █████████    ██                │
 20% │    ██  ███████  ███████████  ████               │
  0% │▁▁▁▁██▁▁████████▁████████████▁█████▁▁▁▁▁▁▁▁▁▁▁▁▁│
     └────────────────────────────────────────────────┘
      00  02  04  06  08  10  12  14  16  18  20  22
```

After the learning period, also shows impact metrics:
- Windows avoided
- Utilization improvement
- Wasted time saved

#### `ccmax analyze`

Analyzes your usage patterns and provides recommendations:

```bash
ccmax analyze           # Show analysis (requires learning period complete)
ccmax analyze --force   # Analyze with current data (bypass learning period)
ccmax analyze --save    # Save recommendations to config
```

Output includes:
- Weekly usage patterns
- Recommended start times per day of week
- Confidence scores based on data consistency

#### `ccmax adjust`

Runs adaptive adjustment to blend recent patterns with existing recommendations:

```bash
ccmax adjust            # Run adjustment if due (every 7 days)
ccmax adjust --force    # Force adjustment now
ccmax adjust --dry-run  # Preview changes without applying
ccmax adjust --status   # Show adjustment status
```

Uses exponential moving average (EMA) to smoothly update recommendations over time.

#### `ccmax daemon`

Manages the background notification daemon:

```bash
ccmax daemon start      # Start daemon (background process)
ccmax daemon stop       # Stop daemon
ccmax daemon status     # Check if daemon is running
```

The daemon:
- Checks every minute for notification opportunities
- Sends desktop notifications at optimal start times
- Warns when your window is about to end (30min, 15min, 5min)
- Runs adaptive adjustment weekly (when enabled)

#### `ccmax config`

View and modify configuration:

```bash
ccmax config                              # Show all settings
ccmax config get learning_period_days     # Get specific value
ccmax config set notifications_enabled false  # Set value
ccmax config set optimal_start_times.monday 09:00  # Set nested value
ccmax config reset                        # Reset to defaults
```

Configuration options:

| Option                       | Default | Description                              |
|------------------------------|---------|------------------------------------------|
| `learning_period_days`       | 7       | Days to learn patterns before optimizing |
| `notifications_enabled`      | true    | Enable desktop notifications             |
| `notification_advance_minutes` | 5     | Minutes before optimal time to notify    |
| `auto_adjust_enabled`        | true    | Enable automatic pattern adjustment      |
| `optimal_start_times.*`      | null    | Optimal start time per day (HH:MM)       |

#### `ccmax export`

Export your usage data:

```bash
ccmax export                      # Export as JSON to stdout
ccmax export --format csv         # Export as CSV
ccmax export --type events        # Export only events
ccmax export --type windows       # Export only windows
```

#### `ccmax uninstall`

Remove ccmax:

```bash
ccmax uninstall          # Remove hooks, keep data
ccmax uninstall --purge  # Remove hooks AND delete all data
ccmax uninstall --dry-run  # Preview what would be removed
```

## How It Works

### Usage Tracking

ccmax installs hooks into Claude Code via `~/.claude/settings.json`:
- `PreToolUse` - Fires before each tool invocation
- `PostToolUse` - Fires after each tool completes
- `UserPromptSubmit` - Fires when you send a prompt

These hooks record timestamps to a local SQLite database, building a picture of your usage patterns.

### Window Detection

When you start using Claude Code, ccmax detects the start of a new 5-hour window. It tracks:
- Window start and end times
- Active minutes within each window
- Utilization percentage (active time / 300 minutes)

### Pattern Analysis

During the learning period, ccmax:
1. Groups events into sessions (30-minute gap = new session)
2. Calculates hourly activity distribution
3. Identifies patterns by day of week
4. Computes optimal start times that maximize window utilization

### Adaptive Adjustment

After the learning period, ccmax continuously improves:
- Every 7 days, new patterns are analyzed
- Recommendations blend with existing using EMA (α=0.3)
- Trend detection identifies if patterns are shifting earlier/later

## Data Storage

All data is stored locally in `~/.claude-code-maximizer/`:

| File          | Purpose                               |
|---------------|---------------------------------------|
| `usage.db`    | SQLite database with usage events     |
| `config.json` | User configuration                    |
| `state.json`  | Runtime state (install time, PID)     |

### Database Schema

```sql
-- Raw usage events from hooks
usage_events (id, timestamp, event_type, tool_name, session_id)

-- 5h usage windows
usage_windows (id, window_start, window_end, active_minutes, utilization_pct)

-- Impact tracking metrics
impact_metrics (id, date, windows_used, windows_predicted, avg_utilization, is_optimized)

-- Baseline stats from learning period
baseline_stats (key, value)
```

## Privacy

- **All data stays local** - Nothing is sent to any server
- **No network requests** - ccmax works entirely offline
- **Full control** - Export or delete your data anytime

## Troubleshooting

### Hooks not working

Verify hooks are installed:
```bash
cat ~/.claude/settings.json | grep ccmax
```

Re-run install if needed:
```bash
ccmax install
```

### Daemon not sending notifications

Check if daemon is running:
```bash
ccmax daemon status
```

Verify `notify-send` is available:
```bash
which notify-send
```

### No data being recorded

Make sure the database exists:
```bash
ls -la ~/.claude-code-maximizer/usage.db
```

Check event count:
```bash
ccmax status
```

### Reset everything

```bash
ccmax uninstall --purge
ccmax install
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev <command>

# Type check
bun run typecheck

# Build binary
bun run build
```

### Project Structure

```
src/
├── cli/              # Command implementations
│   ├── index.ts      # CLI entry point
│   └── commands/     # Individual commands
├── db/               # SQLite database layer
├── config/           # Configuration management
├── hook/             # Claude Code hook handling
├── daemon/           # Background daemon
├── analyzer/         # Pattern analysis
│   ├── aggregator.ts # Event aggregation
│   ├── optimizer.ts  # Start time optimization
│   ├── patterns.ts   # Weekly pattern detection
│   └── adaptive.ts   # Continuous adjustment
├── usage/            # Claude CLI usage parsing
└── utils/            # Shared utilities
```

## License

MIT
