import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { initialStore, type Intent, type LocalStore } from "@/lib/domain";

const storeDir = path.join(process.cwd(), ".intentlock");
const storeFile = path.join(storeDir, "store.json");
let writeQueue: Promise<unknown> = Promise.resolve();

type GlobalStore = typeof globalThis & { intentLockPool?: Pool; intentLockSchema?: Promise<void> };
const globalStore = globalThis as GlobalStore;
function postgresPool(): Pool {
  if (!globalStore.intentLockPool) globalStore.intentLockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30_000 });
  return globalStore.intentLockPool;
}

async function ensurePostgres() {
  if (!globalStore.intentLockSchema) {
    globalStore.intentLockSchema = (async () => {
      const pool = postgresPool();
      await pool.query(`CREATE TABLE IF NOT EXISTS intentlock_state (
        singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        state jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("INSERT INTO intentlock_state (singleton, state) VALUES (TRUE, $1::jsonb) ON CONFLICT (singleton) DO NOTHING", [JSON.stringify(initialStore)]);
    })().catch(error => { globalStore.intentLockSchema = undefined; throw error; });
  }
  await globalStore.intentLockSchema;
}

function normalizeStore(input: unknown): { store: LocalStore; migrated: boolean } {
  const parsed = (typeof input === "string" ? JSON.parse(input) : structuredClone(input)) as LocalStore;
  if (!parsed || !Array.isArray(parsed.intents) || typeof parsed.retryLimit !== "number") throw new Error("Payment store has an invalid shape.");
  let migrated = false;
  if (typeof parsed.waitMinutes !== "number") { parsed.waitMinutes = 5; migrated = true; }
  if (typeof parsed.policyVersion !== "number") { parsed.policyVersion = 1; migrated = true; }
  if (typeof parsed.version !== "number") { parsed.version = 1; migrated = true; }
  for (const intent of parsed.intents) {
    const legacy = intent as Intent & Partial<Pick<Intent, "providerOrders" | "retryCount" | "retryApproved" | "capturedCount" | "fulfilled" | "failureConfirmedAt" | "events">>;
    if (!Array.isArray(legacy.providerOrders)) { legacy.providerOrders = [legacy.order]; migrated = true; }
    if (legacy.status === "Review required" && legacy.providerOrders.length < 2) { legacy.providerOrders.push(`order_Q${legacy.id.replace(/[^a-z0-9]/gi, "").slice(-7)}`); migrated = true; }
    if (typeof legacy.retryCount !== "number") { legacy.retryCount = 0; migrated = true; }
    if (typeof legacy.retryApproved !== "boolean") { legacy.retryApproved = false; migrated = true; }
    if (typeof legacy.capturedCount !== "number") { legacy.capturedCount = legacy.status === "Paid" ? 1 : legacy.status === "Review required" ? 2 : 0; migrated = true; }
    if (typeof legacy.fulfilled !== "boolean") { legacy.fulfilled = legacy.status === "Paid"; migrated = true; }
    if (!Array.isArray(legacy.events)) { legacy.events = []; migrated = true; }
    for (const event of legacy.events) if (event.policyVersion === undefined) { event.policyVersion = 1; migrated = true; }
    if (legacy.failureConfirmedAt === undefined) { legacy.failureConfirmedAt = legacy.status === "Recovery eligible" ? new Date(Date.now() - 8 * 60_000).toISOString() : null; migrated = true; }
  }
  return { store: parsed, migrated };
}

async function writeFileStore(store: LocalStore) {
  await mkdir(storeDir, { recursive: true });
  const temporary = `${storeFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, storeFile);
}

async function withLockedDatabase<T>(operation: (client: PoolClient, store: LocalStore) => Promise<T>): Promise<{ result: T; store: LocalStore }> {
  await ensurePostgres();
  const client = await postgresPool().connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{ state: unknown }>("SELECT state FROM intentlock_state WHERE singleton = TRUE FOR UPDATE");
    const normalized = normalizeStore(row.rows[0]?.state);
    const store = normalized.store;
    if (normalized.migrated) await client.query("UPDATE intentlock_state SET state = $1::jsonb, updated_at = now() WHERE singleton = TRUE", [JSON.stringify(store)]);
    const result = await operation(client, store);
    await client.query("COMMIT");
    return { result, store };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function readStore(): Promise<LocalStore> {
  if (process.env.DATABASE_URL) return (await withLockedDatabase(async (_client, store) => structuredClone(store))).result;
  try {
    const { store, migrated } = normalizeStore(await readFile(storeFile, "utf8"));
    if (migrated) await writeFileStore(store);
    return store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFileStore(initialStore);
    return structuredClone(initialStore);
  }
}

export async function updateStore<T>(update: (store: LocalStore) => T | Promise<T>): Promise<{ result: T; store: LocalStore }> {
  if (process.env.DATABASE_URL) {
    return withLockedDatabase(async (client, store) => {
      const result = await update(store);
      store.version += 1;
      await client.query("UPDATE intentlock_state SET state = $1::jsonb, updated_at = now() WHERE singleton = TRUE", [JSON.stringify(store)]);
      return result;
    });
  }
  const operation = writeQueue.then(async () => {
    let store: LocalStore;
    try { store = normalizeStore(await readFile(storeFile, "utf8")).store; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      store = structuredClone(initialStore);
    }
    const result = await update(store);
    store.version += 1;
    await writeFileStore(store);
    return { result, store };
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function storageMode(): "postgresql" | "local-json" { return process.env.DATABASE_URL ? "postgresql" : "local-json"; }
