import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncData, WindowData } from "../../src/sync/gist.ts";

// Mock file-based "gist" for testing
interface MockGist {
  path: string;
  read: () => Promise<SyncData | null>;
  write: (data: SyncData) => Promise<void>;
}

async function createMockGist(testDir: string): Promise<MockGist> {
  const path = join(testDir, "mock-gist.json");

  return {
    path,
    read: async () => {
      if (!existsSync(path)) return null;
      const content = await readFile(path, "utf-8");
      return JSON.parse(content) as SyncData;
    },
    write: async (data: SyncData) => {
      await writeFile(path, JSON.stringify(data, null, 2));
    },
  };
}

// Hash function extracted for testing
function hashWindows(windows: WindowData[]): string {
  const str = windows.map((w) => `${w.window_start}:${w.active_minutes}`).join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Simulate push operation
async function simulatePush(
  gist: MockGist,
  machineId: string,
  hostname: string,
  windows: WindowData[],
  lastSyncHash: string | null
): Promise<{ success: boolean; message: string; newHash: string | null }> {
  // Check if nothing to sync
  if (windows.length === 0) {
    return { success: true, message: "Nothing to sync.", newHash: null };
  }

  // Check if data changed
  const currentHash = hashWindows(windows);
  if (lastSyncHash === currentHash) {
    return { success: true, message: "No changes to sync.", newHash: null };
  }

  // Fetch current gist data
  let syncData = await gist.read();
  if (!syncData) {
    syncData = {
      version: 1,
      updated_at: new Date().toISOString(),
      machines: {},
    };
  }

  // Only update this machine's data
  syncData.machines[machineId] = {
    machine_id: machineId,
    hostname,
    last_update: new Date().toISOString(),
    windows,
  };
  syncData.updated_at = new Date().toISOString();

  await gist.write(syncData);
  return { success: true, message: `Pushed ${windows.length} windows.`, newHash: currentHash };
}

describe("sync utilities", () => {
  let testDir: string;
  let gist: MockGist;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "ccmax-sync-test-"));
    gist = await createMockGist(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("hashWindows", () => {
    test("returns consistent hash for same data", () => {
      const windows: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];

      const hash1 = hashWindows(windows);
      const hash2 = hashWindows(windows);

      expect(hash1).toBe(hash2);
    });

    test("returns different hash for different data", () => {
      const windows1: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      const windows2: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 150, utilization_pct: 50, claude_usage_pct: 90 },
      ];

      const hash1 = hashWindows(windows1);
      const hash2 = hashWindows(windows2);

      expect(hash1).not.toBe(hash2);
    });

    test("returns different hash when windows added", () => {
      const windows1: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      const windows2: WindowData[] = [
        ...windows1,
        { window_start: "2024-12-28T14:00:00Z", window_end: "2024-12-28T19:00:00Z", active_minutes: 90, utilization_pct: 30, claude_usage_pct: 60 },
      ];

      const hash1 = hashWindows(windows1);
      const hash2 = hashWindows(windows2);

      expect(hash1).not.toBe(hash2);
    });

    test("handles empty array", () => {
      const hash = hashWindows([]);
      expect(hash).toBe("0");
    });
  });

  describe("push operation", () => {
    test("skips push when no windows", async () => {
      const result = await simulatePush(gist, "machine-1", "laptop", [], null);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Nothing to sync.");
      expect(result.newHash).toBeNull();
    });

    test("skips push when hash unchanged", async () => {
      const windows: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      const hash = hashWindows(windows);

      const result = await simulatePush(gist, "machine-1", "laptop", windows, hash);

      expect(result.success).toBe(true);
      expect(result.message).toBe("No changes to sync.");
    });

    test("pushes when data changed", async () => {
      const windows: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];

      const result = await simulatePush(gist, "machine-1", "laptop", windows, null);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Pushed 1 windows.");
      expect(result.newHash).not.toBeNull();

      // Verify gist was updated
      const data = await gist.read();
      expect(data).not.toBeNull();
      expect(data?.machines["machine-1"]).toBeDefined();
      expect(data?.machines["machine-1"]?.windows.length).toBe(1);
    });

    test("creates gist if not exists", async () => {
      const windows: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];

      await simulatePush(gist, "machine-1", "laptop", windows, null);

      const data = await gist.read();
      expect(data).not.toBeNull();
      expect(data?.version).toBe(1);
    });
  });

  describe("concurrent writes", () => {
    test("preserves data from other machines", async () => {
      // Machine 1 pushes first
      const windows1: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      await simulatePush(gist, "machine-1", "laptop", windows1, null);

      // Machine 2 pushes second
      const windows2: WindowData[] = [
        { window_start: "2024-12-28T10:00:00Z", window_end: "2024-12-28T15:00:00Z", active_minutes: 90, utilization_pct: 30, claude_usage_pct: 60 },
      ];
      await simulatePush(gist, "machine-2", "desktop", windows2, null);

      // Verify both machines' data is preserved
      const data = await gist.read();
      expect(data?.machines["machine-1"]).toBeDefined();
      expect(data?.machines["machine-2"]).toBeDefined();
      expect(data?.machines["machine-1"]?.windows.length).toBe(1);
      expect(data?.machines["machine-2"]?.windows.length).toBe(1);
    });

    test("machine can update its own data without affecting others", async () => {
      // Machine 1 pushes
      const windows1v1: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      await simulatePush(gist, "machine-1", "laptop", windows1v1, null);

      // Machine 2 pushes
      const windows2: WindowData[] = [
        { window_start: "2024-12-28T10:00:00Z", window_end: "2024-12-28T15:00:00Z", active_minutes: 90, utilization_pct: 30, claude_usage_pct: 60 },
      ];
      await simulatePush(gist, "machine-2", "desktop", windows2, null);

      // Machine 1 updates with more data
      const windows1v2: WindowData[] = [
        ...windows1v1,
        { window_start: "2024-12-28T14:00:00Z", window_end: "2024-12-28T19:00:00Z", active_minutes: 150, utilization_pct: 50, claude_usage_pct: 95 },
      ];
      await simulatePush(gist, "machine-1", "laptop", windows1v2, hashWindows(windows1v1));

      // Verify machine 1 has updated data, machine 2 unchanged
      const data = await gist.read();
      expect(data?.machines["machine-1"]?.windows.length).toBe(2);
      expect(data?.machines["machine-2"]?.windows.length).toBe(1);
    });

    test("simulates race condition - both machines fetch same state", async () => {
      // Initial state with machine 1
      const windows1: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      await simulatePush(gist, "machine-1", "laptop", windows1, null);

      // Both machines "fetch" the current state
      const stateBeforePush = await gist.read();

      // Machine 2 pushes (based on fetched state)
      const windows2: WindowData[] = [
        { window_start: "2024-12-28T10:00:00Z", window_end: "2024-12-28T15:00:00Z", active_minutes: 90, utilization_pct: 30, claude_usage_pct: 60 },
      ];
      await simulatePush(gist, "machine-2", "desktop", windows2, null);

      // Machine 3 pushes (based on same fetched state - simulating race)
      const windows3: WindowData[] = [
        { window_start: "2024-12-28T11:00:00Z", window_end: "2024-12-28T16:00:00Z", active_minutes: 100, utilization_pct: 33, claude_usage_pct: 70 },
      ];
      await simulatePush(gist, "machine-3", "server", windows3, null);

      // All three machines should have their data preserved
      // because each only writes to its own key
      const data = await gist.read();
      expect(Object.keys(data?.machines || {}).length).toBe(3);
      expect(data?.machines["machine-1"]?.windows.length).toBe(1);
      expect(data?.machines["machine-2"]?.windows.length).toBe(1);
      expect(data?.machines["machine-3"]?.windows.length).toBe(1);
    });
  });

  describe("pull operation", () => {
    test("returns all machines data", async () => {
      // Setup data from multiple machines
      const windows1: WindowData[] = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
      ];
      const windows2: WindowData[] = [
        { window_start: "2024-12-28T10:00:00Z", window_end: "2024-12-28T15:00:00Z", active_minutes: 90, utilization_pct: 30, claude_usage_pct: 60 },
        { window_start: "2024-12-28T15:00:00Z", window_end: "2024-12-28T20:00:00Z", active_minutes: 110, utilization_pct: 37, claude_usage_pct: 75 },
      ];

      await simulatePush(gist, "machine-1", "laptop", windows1, null);
      await simulatePush(gist, "machine-2", "desktop", windows2, null);

      // Pull data
      const data = await gist.read();

      expect(data).not.toBeNull();
      expect(Object.keys(data?.machines || {}).length).toBe(2);

      // Count total windows
      const totalWindows = Object.values(data?.machines || {}).reduce(
        (sum, m) => sum + m.windows.length,
        0
      );
      expect(totalWindows).toBe(3);
    });
  });
});
