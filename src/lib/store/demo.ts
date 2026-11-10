import "server-only";
import { MemoryStore } from "./memory";

/**
 * Store for the static demo build: the seeded mock data, held in memory only
 * (never reads or writes .data/, never touches MongoDB) and read-only.
 *
 * Render paths log "viewed" audit events and bump share counters; those are
 * silently dropped so every prerendered page sees the same pristine data.
 */
export class DemoStore extends MemoryStore {
  constructor() {
    super(true);
  }

  async addAudit() {}
  async updateShare() {}

  private readOnly(): never {
    throw new Error("The demo is read-only");
  }
  async createPatient() {
    return this.readOnly();
  }
  async updatePatient() {
    return this.readOnly();
  }
  async deletePatient(): Promise<never> {
    return this.readOnly();
  }
  async upsertSession() {
    return this.readOnly();
  }
  async addRecording() {
    return this.readOnly();
  }
  async createShare() {
    return this.readOnly();
  }
}
