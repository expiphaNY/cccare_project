import fs from "node:fs";
import path from "node:path";
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

interface DB {
  version: number;
  patients: Patient[];
  sessions: Session[];
  recordings: Recording[];
  shares: Share[];
  audit: AuditEvent[];
  receipts: DeletionReceipt[];
}

const DB_VERSION = 6;
const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "store.json");
const SIGNAL_DIR = path.join(DATA_DIR, "signals");

/** Local development store. Same contract as MongoDB, kept in a JSON file. */
export class MemoryStore implements Store {
  kind = "memory" as const;
  private db: DB;
  private signalCache = new Map<string, SignalData>();

  constructor() {
    this.db = this.load();
  }

  private load(): DB {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as DB;
      if (parsed.version === DB_VERSION) return parsed;
    } catch {
      /* first run */
    }
    const seed = buildSeed();
    const db: DB = { version: DB_VERSION, ...seed, receipts: [] };
    this.persist(db);
    return db;
  }

  private persist(db = this.db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  }

  async listPatients() {
    return structuredClone(this.db.patients);
  }
  async getPatient(id: string) {
    const p = this.db.patients.find((x) => x.id === id);
    return p ? structuredClone(p) : null;
  }
  async createPatient(p: Patient) {
    this.db.patients.push(p);
    this.persist();
  }
  async updatePatient(id: string, patch: Partial<Patient>) {
    const p = this.db.patients.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
    this.persist();
  }
  async deletePatient(id: string, receipt: DeletionReceipt) {
    const recs = this.db.recordings.filter((r) => r.patientId === id);
    const counts = {
      sessions: this.db.sessions.filter((s) => s.patientId === id).length,
      recordings: recs.length,
      shares: this.db.shares.filter((s) => s.patientId === id).length,
      auditEvents: this.db.audit.filter((a) => a.patientId === id).length,
    };
    for (const r of recs) {
      this.signalCache.delete(r.id);
      fs.rmSync(path.join(SIGNAL_DIR, `${r.id}.json`), { force: true });
    }
    this.db.patients = this.db.patients.filter((p) => p.id !== id);
    this.db.sessions = this.db.sessions.filter((s) => s.patientId !== id);
    this.db.recordings = this.db.recordings.filter((r) => r.patientId !== id);
    this.db.shares = this.db.shares.filter((s) => s.patientId !== id);
    this.db.audit = this.db.audit.filter((a) => a.patientId !== id);
    this.db.receipts.push({ ...receipt, counts });
    this.persist();
    return counts;
  }

  async listSessions(patientId: string) {
    return this.db.sessions
      .filter((s) => s.patientId === patientId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }
  async getSession(id: string) {
    return this.db.sessions.find((s) => s.id === id) ?? null;
  }
  async upsertSession(s: Session) {
    const i = this.db.sessions.findIndex((x) => x.id === s.id);
    if (i >= 0) this.db.sessions[i] = s;
    else this.db.sessions.push(s);
    this.persist();
  }

  async listRecordings(patientId: string) {
    return this.db.recordings
      .filter((r) => r.patientId === patientId)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  }
  async getRecording(id: string) {
    return this.db.recordings.find((r) => r.id === id) ?? null;
  }
  async addRecording(r: Recording, signal?: SignalData) {
    this.db.recordings.push(r);
    if (signal) {
      fs.mkdirSync(SIGNAL_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(SIGNAL_DIR, `${r.id}.json`),
        JSON.stringify({
          sampleRateHz: signal.sampleRateHz,
          raw: Array.from(signal.raw),
          rectified: Array.from(signal.rectified),
          envelope: Array.from(signal.envelope),
          ...(signal.motion && { motion: { x: Array.from(signal.motion.x), y: Array.from(signal.motion.y), z: Array.from(signal.motion.z) } }),
        }),
      );
    }
    this.persist();
  }
  async getSignal(recordingId: string): Promise<SignalData | null> {
    const cached = this.signalCache.get(recordingId);
    if (cached) return cached;
    const rec = this.db.recordings.find((r) => r.id === recordingId);
    if (!rec) return null;
    let data: SignalData;
    if (rec.synth) {
      const g = generateSignal(rec.synth, rec.sampleRateHz);
      data = { recordingId, sampleRateHz: g.fs, raw: g.raw, rectified: g.rectified, envelope: g.envelope };
    } else {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(SIGNAL_DIR, `${recordingId}.json`), "utf8"));
        data = {
          recordingId,
          sampleRateHz: j.sampleRateHz,
          raw: Float32Array.from(j.raw),
          rectified: Float32Array.from(j.rectified),
          envelope: Float32Array.from(j.envelope),
          ...(j.motion && { motion: { x: Float32Array.from(j.motion.x), y: Float32Array.from(j.motion.y), z: Float32Array.from(j.motion.z) } }),
        };
      } catch {
        return null;
      }
    }
    if (this.signalCache.size > 200) this.signalCache.clear();
    this.signalCache.set(recordingId, data);
    return data;
  }

  async listShares(patientId: string) {
    return this.db.shares
      .filter((s) => s.patientId === patientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getShare(token: string) {
    return this.db.shares.find((s) => s.token === token) ?? null;
  }
  async createShare(s: Share) {
    this.db.shares.push(s);
    this.persist();
  }
  async updateShare(token: string, patch: Partial<Share>) {
    const s = this.db.shares.find((x) => x.token === token);
    if (s) Object.assign(s, patch);
    this.persist();
  }

  async listAudit(patientId: string) {
    return this.db.audit
      .filter((a) => a.patientId === patientId)
      .sort((a, b) => b.at.localeCompare(a.at));
  }
  async addAudit(e: AuditEvent) {
    this.db.audit.push(e);
    this.persist();
  }

  async listDeletionReceipts() {
    return [...this.db.receipts].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
}
