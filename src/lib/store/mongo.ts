// =============================================================================
// mongo.ts : THE REAL DATABASE (MONGODB)
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Stores patients, sessions, recordings, share links, the audit log and the assistant's drafts as MongoDB collections, and each set's waveform as compact binary. It creates its indexes on start and seeds the demo data into an empty database.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import { Binary, MongoClient, type Db } from "mongodb";
import { buildSeed, synthExtras } from "../mock";
import { generateMotion, generateSignal } from "../signal";
import type {
  AuditEvent,
  DeletionReceipt,
  Patient,
  Recording,
  Session,
  Share,
  SignalData,
  Suggestion,
} from "../types";
import type { Store } from "./types";

/**
 * THE REAL DATABASE (MongoDB). Each "collection" below is like a table.
 *
 * In plain words:
 *   patients, sessions, recordings = the small facts (who, when, which exercise, the metrics)
 *   signals                        = the big waveform data, stored as compact binary numbers
 *   shares                         = private links for outside viewers
 *   audit_events                   = a log of who looked at what
 *   deletion_receipts              = proof that data was deleted (holds no health data)
 *   suggestions                    = the AI helper's ideas (drafts the clinician approves or declines)
 *
 * Why the waveform is separate: it is large, and most pages only need the small facts.
 *
 * Technical detail (for reference):
 *  patients           { _id: patientId, ...Patient }
 *  sessions           { _id: sessionId, patientId, startedAt, name, location, painScore?, notes? }   idx: {patientId, startedAt}
 *                     (name = what the clinician typed, or the date, then " · " and the start time)
 *  recordings         { _id: recordingId, patientId, sessionId, exercise, setNumber, recordedAt, metrics, ... }
 *                                                                          idx: {patientId, recordedAt}, {sessionId}
 *  signals            { _id: recordingId, patientId, sampleRateHz, raw: BinData(float32 LE), rectified, envelope, motion?{x,y,z} }
 *                     (raw/rectified are empty when the device only streamed the envelope)
 *                     (one doc per set; ~100 KB per channel for 25 s @ 1 kHz, well under 16 MB)
 *  shares             { _id: token, patientId, expiresAt, revokedAt, ... } idx: {patientId}
 *  audit_events       { _id, patientId, at, actor, action, detail }        idx: {patientId, at:-1}
 *  deletion_receipts  { _id, patientRef(sha256), deletedAt, counts }       (no health data)
 *  suggestions        { _id, patientId, kind, status, createdAt, title, body, proposedLoad?, ... } idx: {patientId, createdAt:-1}
 *
 *  recordings also carry  load { value, unit, kg }  (weight lifted in the set: the number the clinician typed,
 *                         the unit they picked (kg or lb), and the same weight in kg so sets in different units compare)
 *  and repCheck { status, emgReps, motionReps, verifiedReps, agreement, reps[] }
 *  and tremor { level, headlineMg, holdRmsMg, offAxisRmsMg, peakHz, rhythmicityPct, perRepMg[], ... }
 *  (EMG vs accelerometer cross-check). patients carry prescribedLoad { value, unit, kg }, entered the same way.
 *
 * Production hardening (not needed for the demo): enable Queryable Encryption
 * or CSFLE on name/dob/mrn, TLS-only connections, and a least-privilege DB user.
 */

type WithId<T> = T & { _id: string };

const strip = <T>(doc: WithId<T> | null): T | null => {
  if (!doc) return null;
  const { _id, ...rest } = doc as WithId<T> & Record<string, unknown>;
  void _id;
  return rest as T;
};

const toBin = (a: Float32Array) => new Binary(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
const fromBin = (b: Binary) => {
  const buf = b.buffer;
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
};

const g = globalThis as unknown as { __mongoClient?: Promise<MongoClient>; __mongoSeeded?: Promise<void> };

export class MongoStore implements Store {
  kind = "mongodb" as const;
  private dbPromise: Promise<Db>;

  constructor(uri: string, dbName = process.env.MONGODB_DB ?? "myocare") {
    // Give up after 5 seconds instead of waiting 30. If the connection fails,
    // forget it so the next request can try again.
    g.__mongoClient ??= new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 })
      .connect()
      .catch((e) => {
        g.__mongoClient = undefined;
        g.__mongoSeeded = undefined;
        throw e;
      });
    this.dbPromise = g.__mongoClient.then((c) => c.db(dbName));
    g.__mongoSeeded ??= this.dbPromise.then((db) => this.ensureSeeded(db));
    g.__mongoSeeded.catch(() => {});
  }

  /** Waits until we are connected to the database. Fails if it cannot be reached. */
  async ready() {
    await this.db();
  }

  private async db() {
    const db = await this.dbPromise;
    await g.__mongoSeeded;
    return db;
  }

  // First-time setup: make searches fast (indexes) and add demo data if the database is empty.
  private async ensureSeeded(db: Db) {
    await Promise.all([
      db.collection("sessions").createIndex({ patientId: 1, startedAt: 1 }),
      db.collection("recordings").createIndex({ patientId: 1, recordedAt: 1 }),
      db.collection("recordings").createIndex({ sessionId: 1 }),
      db.collection("shares").createIndex({ patientId: 1 }),
      db.collection("audit_events").createIndex({ patientId: 1, at: -1 }),
      db.collection("signals").createIndex({ patientId: 1 }),
      db.collection("suggestions").createIndex({ patientId: 1, createdAt: -1 }),
      db.collection("recordings").createIndex({ "load.kg": 1 }),
    ]);
    await this.importLocalSuggestions(db);
    const any = await db.collection("patients").estimatedDocumentCount();
    if (any > 0) {
      await this.backfillSynthetic(db);
      return;
    }
    if (process.env.MONGODB_SEED === "false") return;
    const seed = buildSeed();
    const withId = <T extends object>(xs: T[], key: keyof T) =>
      xs.map((x) => ({ _id: String(x[key]), ...x }));
    await db.collection("patients").insertMany(withId(seed.patients, "id") as never[]);
    await db.collection("sessions").insertMany(withId(seed.sessions, "id") as never[]);
    await db.collection("recordings").insertMany(withId(seed.recordings, "id") as never[]);
    await db.collection("shares").insertMany(withId(seed.shares, "token") as never[]);
    await db.collection("audit_events").insertMany(withId(seed.audit, "id") as never[]);
  }

  /**
   * Seed recordings stored before loads, the EMG/accelerometer cross-check and
   * tremor existed get them (deterministic from their seed), and seed patients get a
   * prescribed load. Only touches synthetic recordings missing the fields.
   */
  private async backfillSynthetic(db: Db) {
    const recs = db.collection<WithId<Recording>>("recordings");
    const missing = await recs.find({ synth: { $exists: true }, $or: [{ load: { $exists: false } }, { repCheck: { $exists: false } }, { tremor: { $exists: false } }] }).toArray();
    if (missing.length) {
      await recs.bulkWrite(
        missing.map((r) => ({ updateOne: { filter: { _id: r._id }, update: { $set: { ...synthExtras(r), hasMotion: true } } } })),
        { ordered: false },
      );
      console.log(`[store] Added loads, rep checks and tremor to ${missing.length} seed recording(s).`);
    }
    const pats = db.collection<WithId<Patient>>("patients");
    for (const p of await pats.find({ prescribedLoad: { $exists: false } }).toArray()) {
      const last = await recs.find({ patientId: p._id, load: { $exists: true } }).sort({ recordedAt: -1 }).limit(1).next();
      if (last?.load) await pats.updateOne({ _id: p._id }, { $set: { prescribedLoad: last.load } });
    }
  }

  /**
   * Suggestions drafted while MongoDB was unreachable were written to the local
   * file store (.data/store.json). Copy any that Mongo doesn't have yet so none
   * are lost. Insert-only: a document already in Mongo is never overwritten.
   */
  private async importLocalSuggestions(db: Db) {
    let local: Suggestion[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".data", "store.json"), "utf8")) as { suggestions?: Suggestion[] };
      local = parsed.suggestions ?? [];
    } catch {
      return; // no local store, nothing to import
    }
    if (!local.length) return;
    const res = await db.collection("suggestions").bulkWrite(
      local.map((s) => ({ updateOne: { filter: { _id: s.id as never }, update: { $setOnInsert: { _id: s.id, ...s } as never }, upsert: true } })),
      { ordered: false },
    );
    if (res.upsertedCount) console.log(`[store] Imported ${res.upsertedCount} suggestion(s) from the local file store into MongoDB.`);
  }

  private col<T>(name: string) {
    return this.db().then((d) => d.collection<WithId<T>>(name));
  }

  async listPatients() {
    const c = await this.col<Patient>("patients");
    return (await c.find().sort({ lastName: 1 }).toArray()).map((d) => strip(d)!);
  }
  async getPatient(id: string) {
    const c = await this.col<Patient>("patients");
    return strip(await c.findOne({ _id: id }));
  }
  async createPatient(p: Patient) {
    const c = await this.col<Patient>("patients");
    await c.insertOne({ _id: p.id, ...p });
  }
  async updatePatient(id: string, patch: Partial<Patient>) {
    const c = await this.col<Patient>("patients");
    await c.updateOne({ _id: id }, { $set: patch });
  }
  // Deleting a patient deletes everything linked to them, then saves a receipt (with no health data).
  async deletePatient(id: string, receipt: DeletionReceipt) {
    const db = await this.db();
    const counts = {
      sessions: (await db.collection("sessions").deleteMany({ patientId: id })).deletedCount,
      recordings: (await db.collection("recordings").deleteMany({ patientId: id })).deletedCount,
      shares: (await db.collection("shares").deleteMany({ patientId: id })).deletedCount,
      auditEvents: (await db.collection("audit_events").deleteMany({ patientId: id })).deletedCount,
    };
    await db.collection("signals").deleteMany({ patientId: id });
    await db.collection("suggestions").deleteMany({ patientId: id });
    await db.collection<WithId<Patient>>("patients").deleteOne({ _id: id });
    await db
      .collection<WithId<DeletionReceipt>>("deletion_receipts")
      .insertOne({ _id: receipt.id, ...receipt, counts });
    return counts;
  }

  async listSessions(patientId: string) {
    const c = await this.col<Session>("sessions");
    return (await c.find({ patientId }).sort({ startedAt: 1 }).toArray()).map((d) => strip(d)!);
  }
  async getSession(id: string) {
    const c = await this.col<Session>("sessions");
    return strip(await c.findOne({ _id: id }));
  }
  async upsertSession(s: Session) {
    const c = await this.col<Session>("sessions");
    await c.replaceOne({ _id: s.id }, { ...s } as never, { upsert: true });
  }

  async listRecordings(patientId: string) {
    const c = await this.col<Recording>("recordings");
    return (await c.find({ patientId }).sort({ recordedAt: 1 }).toArray()).map((d) => strip(d)!);
  }
  async getRecording(id: string) {
    const c = await this.col<Recording>("recordings");
    return strip(await c.findOne({ _id: id }));
  }
  // Saves a set in two parts: the small facts go in "recordings", the waveform goes in "signals".
  async addRecording(r: Recording, signal?: SignalData) {
    const db = await this.db();
    await db.collection<WithId<Recording>>("recordings").insertOne({ _id: r.id, ...r });
    if (signal) {
      await db.collection("signals").insertOne({
        _id: r.id as never,
        patientId: r.patientId,
        sampleRateHz: signal.sampleRateHz,
        raw: toBin(signal.raw),
        rectified: toBin(signal.rectified),
        envelope: toBin(signal.envelope),
        ...(signal.motion && { motion: { x: toBin(signal.motion.x), y: toBin(signal.motion.y), z: toBin(signal.motion.z) } }),
      });
    }
  }
  // Loads the waveform. Demo recordings are re-made on the spot; real ones are read from the database.
  async getSignal(recordingId: string): Promise<SignalData | null> {
    const rec = await this.getRecording(recordingId);
    if (!rec) return null;
    if (rec.synth) {
      const s = generateSignal(rec.synth, rec.sampleRateHz);
      return { recordingId, sampleRateHz: s.fs, raw: s.raw, rectified: s.rectified, envelope: s.envelope, motion: generateMotion(rec.synth, rec.sampleRateHz) };
    }
    const db = await this.db();
    const doc = await db.collection("signals").findOne({ _id: recordingId as never });
    if (!doc) return null;
    return {
      recordingId,
      sampleRateHz: doc.sampleRateHz,
      raw: fromBin(doc.raw),
      rectified: fromBin(doc.rectified),
      envelope: fromBin(doc.envelope),
      ...(doc.motion && { motion: { x: fromBin(doc.motion.x), y: fromBin(doc.motion.y), z: fromBin(doc.motion.z) } }),
    };
  }

  async listShares(patientId: string) {
    const c = await this.col<Share>("shares");
    return (await c.find({ patientId }).sort({ createdAt: -1 }).toArray()).map((d) => strip(d)!);
  }
  async getShare(token: string) {
    const c = await this.col<Share>("shares");
    return strip(await c.findOne({ _id: token }));
  }
  async createShare(s: Share) {
    const c = await this.col<Share>("shares");
    await c.insertOne({ _id: s.token, ...s });
  }
  async updateShare(token: string, patch: Partial<Share>) {
    const c = await this.col<Share>("shares");
    await c.updateOne({ _id: token }, { $set: patch });
  }

  async listAudit(patientId: string) {
    const c = await this.col<AuditEvent>("audit_events");
    return (await c.find({ patientId }).sort({ at: -1 }).toArray()).map((d) => strip(d)!);
  }
  async addAudit(e: AuditEvent) {
    const c = await this.col<AuditEvent>("audit_events");
    await c.insertOne({ _id: e.id, ...e });
  }

  async listDeletionReceipts() {
    const c = await this.col<DeletionReceipt>("deletion_receipts");
    return (await c.find().sort({ deletedAt: -1 }).toArray()).map((d) => strip(d)!);
  }

  async listSuggestions(patientId?: string) {
    const c = await this.col<Suggestion>("suggestions");
    return (await c.find(patientId ? { patientId } : {}).sort({ createdAt: -1 }).toArray()).map((d) => strip(d)!);
  }
  async getSuggestion(id: string) {
    const c = await this.col<Suggestion>("suggestions");
    return strip(await c.findOne({ _id: id }));
  }
  async createSuggestion(s: Suggestion) {
    const c = await this.col<Suggestion>("suggestions");
    await c.insertOne({ _id: s.id, ...s });
  }
  async updateSuggestion(id: string, patch: Partial<Suggestion>) {
    const c = await this.col<Suggestion>("suggestions");
    await c.updateOne({ _id: id }, { $set: patch });
  }
}
