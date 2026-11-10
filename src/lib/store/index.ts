import "server-only";
import { connection } from "next/server";
import { MemoryStore } from "./memory";
import { MongoStore } from "./mongo";
import type { Store } from "./types";

const g = globalThis as unknown as { __store?: Promise<Store>; __storeFallback?: string };

/**
 * Returns the active store. Calling `connection()` marks the caller as
 * request-time only, so patient data is never baked into a prerendered page.
 */
export async function getStore(): Promise<Store> {
  await connection();
  g.__store ??= createStore();
  return g.__store;
}

async function createStore(): Promise<Store> {
  const uri = process.env.MONGODB_URI;
  g.__storeFallback = undefined;
  if (!uri) return new MemoryStore();
  const mongo = new MongoStore(uri);
  try {
    await mongo.ready();
    return mongo;
  } catch (e) {
    const reason = (e as Error).message.split("\n")[0].slice(0, 160);
    if (process.env.NODE_ENV === "production") {
      g.__store = undefined; // let the next request retry
      throw e;
    }
    console.warn(
      `\n[store] MongoDB unreachable (${reason}).\n` +
        `[store] Falling back to the local file store for this dev session.\n` +
        `[store] If using Atlas, add your current IP under Network Access, then restart \`npm run dev\`.\n`,
    );
    g.__storeFallback = reason;
    return new MemoryStore();
  }
}

/**
 * Set when MONGODB_URI is configured but the cluster couldn't be reached and
 * this dev session is writing to the local file store instead.
 */
export async function getStoreFallback(): Promise<string | null> {
  const store = await getStore();
  if (!process.env.MONGODB_URI || store.kind !== "memory") return null;
  return g.__storeFallback ?? "MongoDB was unreachable when this dev server started.";
}

export type { Store };
