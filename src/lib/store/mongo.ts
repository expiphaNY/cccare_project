import { Binary, MongoClient, type Db } from "mongodb";
import { buildSeed } from "../mock";
import { generateSignal } from "../signal";
import type {
  AuditEvent,
  DeletionReceipt,
  Patient,
  Recording,
  Session,
  Share,
  SignalData,
} from "../types";
import type { Store } from "./types";

/**
 * MongoDB collections
 *  patients           { _id: patientId, ...Patient }
 *  sessions           { _id: sessionId, patientId, startedAt, ... }       idx: {patientId, startedAt}
 *  recordings         { _id: recordingId, patientId, sessionId, exercise, setNumber, recordedAt, metrics, ... }
 *                                                                          idx: {patientId, recordedAt}, {sessionId}
 *  signals            { _id: recordingId, patientId, sampleRateHz, raw: BinData(float32 LE), rectified, envelope }
 *                     (one doc per set; ~100 KB per channel for 25 s @ 1 kHz, well under 16 MB)
 *  shares             { _id: token, patientId, expiresAt, revokedAt, ... } idx: {patientId}
 *  audit_events       { _id, patientId, at, actor, action, detail }        idx: {patientId, at:-1}
 *  deletion_receipts  { _id, patientRef(sha256), deletedAt, counts }       (no health data)
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
    // Fail fast (driver default is 30 s per request) and don't cache a failed
    // connection forever — clear it so the next attempt can retry.
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

  /** Resolves once connected and seeded; rejects if the cluster is unreachable. */
  async ready() {
    await this.db();
  }

  private async db() {
    const db = await this.dbPromise;
    await g.__mongoSeeded;
    return db;
  }

  private async ensureSeeded(db: Db) {
    await Promise.all([
      db.collection("sessions").createIndex({ patientId: 1, startedAt: 1 }),
      db.collection("recordings").createIndex({ patientId: 1, recordedAt: 1 }),
      db.collection("recordings").createIndex({ sessionId: 1 }),
      db.collection("shares").createIndex({ patientId: 1 }),
      db.collection("audit_events").createIndex({ patientId: 1, at: -1 }),
      db.collection("signals").createIndex({ patientId: 1 }),
    ]);
    const any = await db.collection("patients").estimatedDocumentCount();
    if (any > 0 || process.env.MONGODB_SEED === "false") return;
    const seed = buildSeed();
    const withId = <T extends object>(xs: T[], key: keyof T) =>
      xs.map((x) => ({ _id: String(x[key]), ...x }));
    await db.collection("patients").insertMany(withId(seed.patients, "id") as never[]);
    await db.collection("sessions").insertMany(withId(seed.sessions, "id") as never[]);
    await db.collection("recordings").insertMany(withId(seed.recordings, "id") as never[]);
    await db.collection("shares").insertMany(withId(seed.shares, "token") as never[]);
    await db.collection("audit_events").insertMany(withId(seed.audit, "id") as never[]);
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
  async deletePatient(id: string, receipt: DeletionReceipt) {
    const db = await this.db();
    const counts = {
      sessions: (await db.collection("sessions").deleteMany({ patientId: id })).deletedCount,
      recordings: (await db.collection("recordings").deleteMany({ patientId: id })).deletedCount,
      shares: (await db.collection("shares").deleteMany({ patientId: id })).deletedCount,
      auditEvents: (await db.collection("audit_events").deleteMany({ patientId: id })).deletedCount,
    };
    await db.collection("signals").deleteMany({ patientId: id });
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
      });
    }
  }
  async getSignal(recordingId: string): Promise<SignalData | null> {
    const rec = await this.getRecording(recordingId);
    if (!rec) return null;
    if (rec.synth) {
      const s = generateSignal(rec.synth, rec.sampleRateHz);
      return { recordingId, sampleRateHz: s.fs, raw: s.raw, rectified: s.rectified, envelope: s.envelope };
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
}
