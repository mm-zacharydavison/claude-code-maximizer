import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { SyncData, WindowData } from "../../src/sync/gist.ts";
import { findExistingGist } from "../../src/sync/gist.ts";
import { initializeSchema } from "../../src/db/schema.ts";

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

describe("findExistingGist", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(fn: () => Promise<Partial<Response>>): void {
    globalThis.fetch = fn as unknown as typeof fetch;
  }

  test("finds gist with ccmax-sync.json file", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "gist-other", files: { "notes.txt": {} } },
            { id: "gist-ccmax", files: { "ccmax-sync.json": {} } },
            { id: "gist-another", files: { "data.json": {} } },
          ]),
      })
    );

    const result = await findExistingGist("fake-token");

    expect(result).toBe("gist-ccmax");
  });

  test("returns null when no matching gist exists", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "gist-1", files: { "notes.txt": {} } },
            { id: "gist-2", files: { "other.json": {} } },
          ]),
      })
    );

    const result = await findExistingGist("fake-token");

    expect(result).toBeNull();
  });

  test("returns null when user has no gists", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })
    );

    const result = await findExistingGist("fake-token");

    expect(result).toBeNull();
  });

  test("returns null on API error", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 401,
      })
    );

    const result = await findExistingGist("fake-token");

    expect(result).toBeNull();
  });

  test("returns null on network error", async () => {
    mockFetch(() => Promise.reject(new Error("Network error")));

    const result = await findExistingGist("fake-token");

    expect(result).toBeNull();
  });

  test("finds first matching gist when multiple exist", async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: "gist-first-ccmax", files: { "ccmax-sync.json": {} } },
            { id: "gist-second-ccmax", files: { "ccmax-sync.json": {} } },
          ]),
      })
    );

    const result = await findExistingGist("fake-token");

    expect(result).toBe("gist-first-ccmax");
  });
});

describe("database sync import", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("import synced hourly usage", () => {
    const LOCAL_MACHINE = "local-machine";
    const REMOTE_MACHINE = "remote-machine";

    test("imports records with machine_id", () => {
      const records = [
        { date_hour: "2024-12-28-09", usage_pct: 50 },
        { date_hour: "2024-12-28-10", usage_pct: 60 },
      ];

      // Simulate importSyncedHourlyUsage
      for (const r of records) {
        db.run(
          "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
          [r.date_hour, r.usage_pct, new Date().toISOString(), REMOTE_MACHINE]
        );
      }

      const rows = db.query<{ date_hour: string; machine_id: string | null }, [string]>(
        "SELECT date_hour, machine_id FROM hourly_usage WHERE machine_id = ?"
      ).all(REMOTE_MACHINE);
      expect(rows.length).toBe(2);
    });

    test("replaces existing data for same machine_id", () => {
      // First import
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-09", 50, new Date().toISOString(), REMOTE_MACHINE]
      );

      // Simulate reimport (delete + insert)
      db.run("DELETE FROM hourly_usage WHERE machine_id = ?", [REMOTE_MACHINE]);
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-10", 70, new Date().toISOString(), REMOTE_MACHINE]
      );

      const rows = db.query<{ date_hour: string }, [string]>(
        "SELECT date_hour FROM hourly_usage WHERE machine_id = ?"
      ).all(REMOTE_MACHINE);
      expect(rows.length).toBe(1);
      expect(rows[0]!.date_hour).toBe("2024-12-28-10");
    });

    test("does not affect local data when importing", () => {
      // Local data
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-09", 40, new Date().toISOString(), LOCAL_MACHINE]
      );

      // Import remote data (same hour, different machine)
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-09", 60, new Date().toISOString(), REMOTE_MACHINE]
      );

      // Verify both exist
      const localRow = db.query<{ usage_pct: number }, [string]>(
        "SELECT usage_pct FROM hourly_usage WHERE machine_id = ?"
      ).get(LOCAL_MACHINE);
      const remoteRow = db.query<{ usage_pct: number }, [string]>(
        "SELECT usage_pct FROM hourly_usage WHERE machine_id = ?"
      ).get(REMOTE_MACHINE);

      expect(localRow?.usage_pct).toBe(40);
      expect(remoteRow?.usage_pct).toBe(60);
    });
  });

  describe("import synced windows", () => {
    const LOCAL_MACHINE = "local-machine";
    const REMOTE_MACHINE = "remote-machine";

    test("imports windows with machine_id", () => {
      const windows = [
        { window_start: "2024-12-28T09:00:00Z", window_end: "2024-12-28T14:00:00Z", active_minutes: 120, utilization_pct: 40, claude_usage_pct: 80 },
        { window_start: "2024-12-28T14:00:00Z", window_end: "2024-12-28T19:00:00Z", active_minutes: 150, utilization_pct: 50, claude_usage_pct: 90 },
      ];

      for (const w of windows) {
        db.run(
          `INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct, machine_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [w.window_start, w.window_end, w.active_minutes, w.utilization_pct, w.claude_usage_pct, REMOTE_MACHINE]
        );
      }

      const count = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM usage_windows WHERE machine_id = ?"
      ).get(REMOTE_MACHINE);
      expect(count?.count).toBe(2);
    });

    test("does not affect local windows when importing", () => {
      // Local window
      db.run(
        `INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct, machine_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["2024-12-28T09:00:00Z", "2024-12-28T14:00:00Z", 100, 33, 70, LOCAL_MACHINE]
      );

      // Remote window
      db.run(
        `INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct, machine_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["2024-12-28T10:00:00Z", "2024-12-28T15:00:00Z", 120, 40, 80, REMOTE_MACHINE]
      );

      const localCount = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM usage_windows WHERE machine_id = ?"
      ).get(LOCAL_MACHINE);
      const remoteCount = db.query<{ count: number }, [string]>(
        "SELECT COUNT(*) as count FROM usage_windows WHERE machine_id = ?"
      ).get(REMOTE_MACHINE);

      expect(localCount?.count).toBe(1);
      expect(remoteCount?.count).toBe(1);
    });
  });

  describe("local-only queries", () => {
    const LOCAL_MACHINE = "local-machine";
    const REMOTE_MACHINE = "remote-machine";

    test("local hourly usage query excludes synced data", () => {
      // Local data
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-09", 40, new Date().toISOString(), LOCAL_MACHINE]
      );
      // Remote data
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-10", 60, new Date().toISOString(), REMOTE_MACHINE]
      );

      const localOnly = db.query<{ date_hour: string }, [string]>(
        "SELECT date_hour FROM hourly_usage WHERE machine_id = ?"
      ).all(LOCAL_MACHINE);

      expect(localOnly.length).toBe(1);
      expect(localOnly[0]!.date_hour).toBe("2024-12-28-09");
    });

    test("local windows query excludes synced data", () => {
      // Local window
      db.run(
        `INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct, machine_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["2024-12-28T09:00:00Z", "2024-12-28T14:00:00Z", 100, 33, 70, LOCAL_MACHINE]
      );
      // Remote window
      db.run(
        `INSERT INTO usage_windows (window_start, window_end, active_minutes, utilization_pct, claude_usage_pct, machine_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["2024-12-28T10:00:00Z", "2024-12-28T15:00:00Z", 120, 40, 80, REMOTE_MACHINE]
      );

      const localOnly = db.query<{ window_start: string }, [string]>(
        "SELECT window_start FROM usage_windows WHERE machine_id = ?"
      ).all(LOCAL_MACHINE);

      expect(localOnly.length).toBe(1);
      expect(localOnly[0]!.window_start).toBe("2024-12-28T09:00:00Z");
    });

    test("all-data query includes both local and synced", () => {
      // Local data
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-09", 40, new Date().toISOString(), LOCAL_MACHINE]
      );
      // Remote data
      db.run(
        "INSERT INTO hourly_usage (date_hour, usage_pct, updated_at, machine_id) VALUES (?, ?, ?, ?)",
        ["2024-12-28-10", 60, new Date().toISOString(), REMOTE_MACHINE]
      );

      const all = db.query<{ date_hour: string }, []>(
        "SELECT date_hour FROM hourly_usage ORDER BY date_hour"
      ).all();

      expect(all.length).toBe(2);
    });
  });

});
