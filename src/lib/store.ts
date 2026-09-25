import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { initialStore, type LocalStore } from "@/lib/domain";

const storeDir = path.join(process.cwd(), ".intentlock");
const storeFile = path.join(storeDir, "store.json");
let writeQueue: Promise<unknown> = Promise.resolve();

async function writeStore(store: LocalStore) {
  await mkdir(storeDir, { recursive: true });
  const temporary = `${storeFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, storeFile);
}

export async function readStore(): Promise<LocalStore> {
  try {
    const raw = await readFile(storeFile, "utf8");
    const parsed = JSON.parse(raw) as LocalStore;
    if (!Array.isArray(parsed.intents) || typeof parsed.retryLimit !== "number") throw new Error("Local store has an invalid shape.");
    let migrated = false;
    if (typeof parsed.waitMinutes !== "number") { parsed.waitMinutes = 5; migrated = true; }
    if (typeof parsed.policyVersion !== "number") { parsed.policyVersion = 1; migrated = true; }
    if (typeof parsed.version !== "number") { parsed.version = 1; migrated = true; }
    for (const intent of parsed.intents) {
      const legacy = intent as LocalStore["intents"][number] & Partial<Pick<LocalStore["intents"][number], "providerOrders" | "retryCount" | "retryApproved" | "capturedCount" | "fulfilled" | "failureConfirmedAt" | "events">>;
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
    if (migrated) await writeStore(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeStore(initialStore);
    return structuredClone(initialStore);
  }
}

export function updateStore<T>(update: (store: LocalStore) => T | Promise<T>): Promise<{ result: T; store: LocalStore }> {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const result = await update(store);
    store.version += 1;
    await writeStore(store);
    return { result, store };
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
