import { writeFileSync } from "fs";
import { isInstalled } from "../../config/state.ts";
import { dbExists } from "../../db/client.ts";
import { getHourlyUsageSince, getWindowsSince, getOptimizedMetrics, getAllBaselineStats } from "../../db/queries.ts";
import { loadConfig } from "../../config/index.ts";
import { loadState } from "../../config/state.ts";

interface ExportData {
  exportedAt: string;
  config: ReturnType<typeof loadConfig>;
  state: ReturnType<typeof loadState>;
  baseline: Record<string, number>;
  hourlyUsage: ReturnType<typeof getHourlyUsageSince>;
  windows: ReturnType<typeof getWindowsSince>;
  impactMetrics: ReturnType<typeof getOptimizedMetrics>;
}

export async function exportData(args: string[]): Promise<void> {
  const outputFile = args.find((a) => !a.startsWith("-")) ?? "ccmax-export.json";
  const format = args.includes("--csv") ? "csv" : "json";

  if (!isInstalled()) {
    console.log("ccmax is not installed. Run 'ccmax install' first.");
    return;
  }

  if (!dbExists()) {
    console.log("No data to export. Use Claude Code to start tracking.");
    return;
  }

  console.log(`Exporting data to ${outputFile}...`);

  // Get all data
  const startDate = new Date(0).toISOString(); // Get all data from beginning
  const hourlyUsage = getHourlyUsageSince(startDate);
  const windows = getWindowsSince(startDate);
  const impactMetrics = getOptimizedMetrics();
  const baseline = getAllBaselineStats();
  const config = loadConfig();
  const state = loadState();

  if (format === "csv") {
    exportCsv(outputFile, hourlyUsage, windows);
  } else {
    exportJson(outputFile, {
      exportedAt: new Date().toISOString(),
      config,
      state,
      baseline,
      hourlyUsage,
      windows,
      impactMetrics,
    });
  }

  console.log(`Exported ${hourlyUsage.length} hourly records and ${windows.length} windows.`);
}

function exportJson(outputFile: string, data: ExportData): void {
  writeFileSync(outputFile, JSON.stringify(data, null, 2));
}

function exportCsv(
  outputFile: string,
  hourlyUsage: ReturnType<typeof getHourlyUsageSince>,
  windows: ReturnType<typeof getWindowsSince>
): void {
  // Export hourly usage
  const hourlyFile = outputFile.replace(".json", "-hourly.csv");
  const hourlyHeader = "date_hour,usage_pct,updated_at\n";
  const hourlyRows = hourlyUsage
    .map((h) => `${h.date_hour},${h.usage_pct},${h.updated_at}`)
    .join("\n");
  writeFileSync(hourlyFile, hourlyHeader + hourlyRows);
  console.log(`  Hourly usage: ${hourlyFile}`);

  // Export windows
  const windowsFile = outputFile.replace(".json", "-windows.csv");
  const windowsHeader = "id,window_start,window_end,active_minutes,utilization_pct,claude_usage_pct\n";
  const windowsRows = windows
    .map((w) => `${w.id},${w.window_start},${w.window_end},${w.active_minutes},${w.utilization_pct},${w.claude_usage_pct}`)
    .join("\n");
  writeFileSync(windowsFile, windowsHeader + windowsRows);
  console.log(`  Windows: ${windowsFile}`);
}
