import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

import { WS_MESSAGE_PERF_PROBE, WS_MESSAGE_SYNC } from "@collab/shared/collab";

import { RoomManager, type SocketLike } from "./room-manager";

type BudgetThresholds = {
  cursorSyncLatencyMs: { p95Max: number; p99Max: number };
  objectSyncLatencyMs: { p95Max: number; p99Max: number };
  canvasFps: { avgMin: number };
  objectCapacity: { min: number };
  concurrentUsers: { min: number };
};

type BudgetsFile = {
  version: number;
  thresholds: BudgetThresholds;
};

type PerfSummary = {
  mode: "local" | "ci";
  concurrentUsers: number;
  samples: {
    cursor: number;
    object: number;
  };
  cursorSyncLatencyMs: Stats;
  objectSyncLatencyMs: Stats;
  objectCapacity: number;
  pass: boolean;
  failures: string[];
  createdAt: string;
};

type Stats = {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
};

type BenchClient = {
  name: string;
  roomId: string;
  doc: Y.Doc;
  socket: SocketLike;
  disconnect: () => void;
  sendProbe: (payload: Record<string, unknown>) => void;
};

const PERF_ROOM_ID = "perf-room";
const OBJECT_MAP_KEY = "objects";
const BUDGETS_PATH = resolve(process.cwd(), "../../docs/performance-budgets.json");
const ARTIFACTS_DIR = resolve(process.cwd(), "../../artifacts/perf");

function parseMode() {
  const modeArg = Bun.argv.find((arg) => arg.startsWith("--mode="));
  if (!modeArg) return "local" as const;
  return modeArg.split("=")[1] === "ci" ? ("ci" as const) : ("local" as const);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function stats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: total / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99)
  };
}

function toLatency(nowMs: number, sentAtMs: number) {
  return Math.max(0, nowMs - sentAtMs);
}

function createBenchClient(args: {
  roomManager: RoomManager;
  roomId: string;
  name: string;
  onProbe: (payload: Record<string, unknown>) => void;
}) {
  const { roomManager, roomId, name, onProbe } = args;
  const doc = new Y.Doc();

  const socket: SocketLike = {
    send(data: Uint8Array) {
      const decoder = decoding.createDecoder(data);
      const encoder = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      if (messageType === WS_MESSAGE_SYNC) {
        encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, socket);
        const reply = encoding.toUint8Array(encoder);
        if (reply.length > 1) {
          roomManager.handleMessage(roomId, socket, reply);
        }
      } else if (messageType === WS_MESSAGE_PERF_PROBE) {
        try {
          const rawPayload = decoding.readVarString(decoder);
          const payload = JSON.parse(rawPayload) as Record<string, unknown>;
          onProbe(payload);
        } catch (error) {
          console.error(`[benchmark] invalid perf probe on ${name}:`, error);
        }
      }
    }
  };

  const onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === socket) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    roomManager.handleMessage(roomId, socket, encoding.toUint8Array(encoder));
  };

  doc.on("update", onLocalUpdate);
  roomManager.connect(roomId, socket);

  const syncEncoder = encoding.createEncoder();
  encoding.writeVarUint(syncEncoder, WS_MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(syncEncoder, doc);
  roomManager.handleMessage(roomId, socket, encoding.toUint8Array(syncEncoder));

  const sendProbe = (payload: Record<string, unknown>) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, WS_MESSAGE_PERF_PROBE);
    encoding.writeVarString(encoder, JSON.stringify(payload));
    roomManager.handleMessage(roomId, socket, encoding.toUint8Array(encoder));
  };

  const disconnect = () => {
    roomManager.disconnect(roomId, socket);
    doc.off("update", onLocalUpdate);
    doc.destroy();
  };

  return {
    name,
    roomId,
    doc,
    socket,
    disconnect,
    sendProbe
  } satisfies BenchClient;
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
  pollIntervalMs = 2
): Promise<boolean> {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) {
      return false;
    }
    await Bun.sleep(pollIntervalMs);
  }
  return true;
}

async function run() {
  const mode = parseMode();
  const users = 5;
  const cursorSamples = mode === "ci" ? 120 : 200;
  const objectSamples = mode === "ci" ? 120 : 200;

  const budgets = (await Bun.file(BUDGETS_PATH).json()) as BudgetsFile;
  const roomManager = new RoomManager();
  const cursorLatencies: number[] = [];
  const objectLatencies: number[] = [];
  const targetReceiverCount = users - 1;

  const cursorPending = new Map<string, number>();
  const objectPending = new Map<string, number>();

  const clients = Array.from({ length: users }).map((_, index) =>
    createBenchClient({
      roomManager,
      roomId: PERF_ROOM_ID,
      name: `client-${index + 1}`,
      onProbe(payload) {
        if (payload.kind !== "cursor") return;
        const id = String(payload.id ?? "");
        if (!id) return;
        const sentAtMs = Number(payload.sentAtMs ?? 0);
        if (!Number.isFinite(sentAtMs)) return;

        const received = cursorPending.get(id) ?? 0;
        cursorLatencies.push(toLatency(performance.now(), sentAtMs));
        if (received + 1 >= targetReceiverCount) {
          cursorPending.delete(id);
        } else {
          cursorPending.set(id, received + 1);
        }
      }
    })
  );

  const sourceClient = clients[0];
  const objectMaps = clients.slice(1).map((client) => client.doc.getMap(OBJECT_MAP_KEY));
  const objectObservers = objectMaps.map((map) => (event: Y.YMapEvent<unknown>) => {
    for (const [key, change] of event.changes.keys) {
      if (change.action !== "add" && change.action !== "update") continue;
      if (!key.startsWith("obj-probe-")) continue;
      const value = map.get(key) as { sentAtMs?: number } | undefined;
      if (!value || typeof value.sentAtMs !== "number") continue;
      objectLatencies.push(toLatency(performance.now(), value.sentAtMs));
      const seen = objectPending.get(key) ?? 0;
      if (seen + 1 >= targetReceiverCount) {
        objectPending.delete(key);
      } else {
        objectPending.set(key, seen + 1);
      }
    }
  });

  objectMaps.forEach((map, index) => map.observe(objectObservers[index]));

  await Bun.sleep(25);

  for (let index = 0; index < cursorSamples; index++) {
    const id = `cursor-probe-${index}`;
    cursorPending.set(id, 0);
    sourceClient.sendProbe({
      id,
      kind: "cursor",
      roomId: PERF_ROOM_ID,
      senderClientId: sourceClient.doc.clientID,
      sentAtMs: performance.now()
    });
    const ok = await waitForCondition(() => !cursorPending.has(id), 2000);
    if (!ok) {
      throw new Error(`Cursor sample timed out for probe ${id}`);
    }
  }

  const sourceObjects = sourceClient.doc.getMap(OBJECT_MAP_KEY);
  for (let index = 0; index < objectSamples; index++) {
    const key = `obj-probe-${index}`;
    objectPending.set(key, 0);
    sourceObjects.set(key, {
      sentAtMs: performance.now(),
      index
    });
    const ok = await waitForCondition(() => !objectPending.has(key), 2000);
    if (!ok) {
      throw new Error(`Object sample timed out for key ${key}`);
    }
  }

  // Capacity check: inject 500 objects and verify all clients can observe them.
  for (let index = objectSamples; index < 500; index++) {
    sourceObjects.set(`obj-probe-${index}`, {
      sentAtMs: performance.now(),
      index
    });
  }

  const capacityReady = await waitForCondition(
    () =>
      clients
        .map((client) => client.doc.getMap(OBJECT_MAP_KEY).size)
        .every((size) => size >= budgets.thresholds.objectCapacity.min),
    4000
  );
  if (!capacityReady) {
    throw new Error("Object capacity propagation timed out before reaching 500 objects.");
  }

  objectMaps.forEach((map, index) => map.unobserve(objectObservers[index]));

  clients.forEach((client) => client.disconnect());

  const cursorStats = stats(cursorLatencies);
  const objectStats = stats(objectLatencies);
  const objectCapacity = sourceObjects.size;
  const failures: string[] = [];
  if (cursorStats.p95 > budgets.thresholds.cursorSyncLatencyMs.p95Max) {
    failures.push(
      `cursorSyncLatencyMs.p95 ${cursorStats.p95.toFixed(2)} > ${budgets.thresholds.cursorSyncLatencyMs.p95Max}`
    );
  }
  if (objectStats.p95 > budgets.thresholds.objectSyncLatencyMs.p95Max) {
    failures.push(
      `objectSyncLatencyMs.p95 ${objectStats.p95.toFixed(2)} > ${budgets.thresholds.objectSyncLatencyMs.p95Max}`
    );
  }
  if (users < budgets.thresholds.concurrentUsers.min) {
    failures.push(`concurrentUsers ${users} < ${budgets.thresholds.concurrentUsers.min}`);
  }
  if (objectCapacity < budgets.thresholds.objectCapacity.min) {
    failures.push(`objectCapacity ${objectCapacity} < ${budgets.thresholds.objectCapacity.min}`);
  }

  const summary: PerfSummary = {
    mode,
    concurrentUsers: users,
    samples: {
      cursor: cursorLatencies.length,
      object: objectLatencies.length
    },
    cursorSyncLatencyMs: cursorStats,
    objectSyncLatencyMs: objectStats,
    objectCapacity,
    pass: failures.length === 0,
    failures,
    createdAt: new Date().toISOString()
  };

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonlPath = resolve(ARTIFACTS_DIR, `ws-benchmark-${timestamp}.jsonl`);
  const latestPath = resolve(ARTIFACTS_DIR, "ws-benchmark-latest.json");
  const jsonl = [
    JSON.stringify({
      type: "metric",
      metric: "cursorSyncLatencyMs",
      ...summary.cursorSyncLatencyMs,
      samples: summary.samples.cursor
    }),
    JSON.stringify({
      type: "metric",
      metric: "objectSyncLatencyMs",
      ...summary.objectSyncLatencyMs,
      samples: summary.samples.object
    }),
    JSON.stringify({
      type: "metric",
      metric: "objectCapacity",
      value: summary.objectCapacity
    }),
    JSON.stringify({
      type: "summary",
      pass: summary.pass,
      failures: summary.failures
    })
  ].join("\n");

  await writeFile(jsonlPath, `${jsonl}\n`, "utf8");
  await writeFile(latestPath, JSON.stringify(summary, null, 2), "utf8");

  console.info(`[perf] ws benchmark artifact: ${jsonlPath}`);
  console.info(`[perf] ws benchmark latest: ${latestPath}`);
  console.info(`[perf] cursor p95=${summary.cursorSyncLatencyMs.p95.toFixed(2)}ms`);
  console.info(`[perf] object p95=${summary.objectSyncLatencyMs.p95.toFixed(2)}ms`);

  if (!summary.pass) {
    console.error("[perf] ws benchmark failed:\n" + summary.failures.map((line) => `- ${line}`).join("\n"));
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("[perf] ws benchmark crashed:", error);
  process.exitCode = 1;
});
