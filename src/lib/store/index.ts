import "server-only";
import { connection } from "next/server";
import { MemoryStore } from "./memory";
import { MongoStore } from "./mongo";
import type { Store } from "./types";

const g = globalThis as unknown as { __store?: Promise<Store> };

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
  if (!uri) return new MemoryStore();
  const mongo = new MongoStore(uri);
  try {
    await mongo.ready();
    return mongo;
  } catch (e) {
    if (process.env.NODE_ENV === "production") {
      g.__store = undefined; // let the next request retry
      throw e;
    }
    console.warn(
      `\n[store] MongoDB unreachable (${(e as Error).message.split("\n")[0].slice(0, 160)}).\n` +
        `[store] Falling back to the local file store for this dev session.\n` +
        `[store] If using Atlas, add your current IP under Network Access, then restart \`npm run dev\`.\n`,
    );
    return new MemoryStore();
  }
}

export type { Store };
