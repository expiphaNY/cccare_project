// =============================================================================
// types.ts : THE STORAGE CONTRACT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The list of operations any store must offer (get, add, delete, list ...). The app only talks to this contract, so the local file, MongoDB and the demo store can be swapped without touching a page.
// =============================================================================

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

/**
 * Storage contract. Two implementations:
 *  - MongoStore  (src/lib/store/mongo.ts)  used when MONGODB_URI is set
 *  - MemoryStore (src/lib/store/memory.ts) local fallback, persists to .data/
 */
export interface Store {
  kind: "mongodb" | "memory";

  listPatients(): Promise<Patient[]>;
  getPatient(id: string): Promise<Patient | null>;
  createPatient(p: Patient): Promise<void>;
  updatePatient(id: string, patch: Partial<Patient>): Promise<void>;
  /** Hard-deletes every record tied to the patient and returns a receipt. */
  deletePatient(id: string, receipt: DeletionReceipt): Promise<DeletionReceipt["counts"]>;

  listSessions(patientId: string): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  upsertSession(s: Session): Promise<void>;

  listRecordings(patientId: string): Promise<Recording[]>;
  getRecording(id: string): Promise<Recording | null>;
  addRecording(r: Recording, signal?: SignalData): Promise<void>;
  /** Raw device data. Synthetic recordings regenerate from their seed. */
  getSignal(recordingId: string): Promise<SignalData | null>;

  listShares(patientId: string): Promise<Share[]>;
  getShare(token: string): Promise<Share | null>;
  createShare(s: Share): Promise<void>;
  updateShare(token: string, patch: Partial<Share>): Promise<void>;

  listAudit(patientId: string): Promise<AuditEvent[]>;
  addAudit(e: AuditEvent): Promise<void>;

  listDeletionReceipts(): Promise<DeletionReceipt[]>;

  /** Assistant-drafted suggestions. Omit patientId to list across all patients. */
  listSuggestions(patientId?: string): Promise<Suggestion[]>;
  getSuggestion(id: string): Promise<Suggestion | null>;
  createSuggestion(s: Suggestion): Promise<void>;
  updateSuggestion(id: string, patch: Partial<Suggestion>): Promise<void>;
}
