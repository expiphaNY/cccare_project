// HL7 FHIR R4 export. Produces a `collection` Bundle that another clinic's
// system can import: Patient, Practitioner, Organization, Device, Condition,
// Consent, one Encounter per session, one Observation per exercise set
// (metrics as components + the envelope waveform as SampledData), and a
// Provenance resource describing who generated the export and when.
//
// Codes: standard terminologies are used where a clear code exists (UCUM
// units, HL7 v3 ActCode, consent scope). EMG set metrics have no LOINC codes
// today, so a local CodeSystem is used and declared — a terminology review
// should map these before production use.

import { randomUUID } from "node:crypto";
import type { PatientBundle } from "../data";
import { CLINICIANS } from "../mock";
import { resampleMean } from "../signal";
import type { Recording, Share, SignalData } from "../types";
import { EXERCISES } from "../types";

const LOCAL = "https://myocare.example/fhir/CodeSystem/emg";
const UCUM = "http://unitsofmeasure.org";

type Res = Record<string, unknown> & { resourceType: string; id: string };

const qty = (value: number, unit: string, code = unit) => ({ value, unit, system: UCUM, code });

export async function buildFhirBundle(
  b: PatientBundle,
  getSignal: (id: string) => Promise<SignalData | null>,
  opts: { includeRaw: boolean; generatedBy: string; share?: Share | null },
) {
  const p = b.patient;
  const entries: Res[] = [];
  const ref = (r: Res) => ({ reference: `${r.resourceType}/${r.id}` });

  const org: Res = {
    resourceType: "Organization",
    id: "org-northside",
    name: "Northside Rehabilitation Clinic",
  };
  const practitioners: Res[] = CLINICIANS.map((c) => ({
    resourceType: "Practitioner",
    id: c.id,
    name: [{ text: c.name }],
    qualification: [{ code: { text: c.title } }],
  }));
  const patient: Res = {
    resourceType: "Patient",
    id: p.id,
    identifier: [{ system: "https://myocare.example/mrn", value: p.mrn }],
    name: [{ family: p.lastName, given: [p.firstName] }],
    gender: p.sex === "other" ? "other" : p.sex,
    birthDate: p.dob,
    generalPractitioner: [{ reference: `Practitioner/${p.clinicianId}` }],
    managingOrganization: ref(org),
  };
  const device: Res = {
    resourceType: "Device",
    id: p.device.id,
    identifier: [{ value: p.device.id }],
    deviceName: [{ name: p.device.model, type: "model-name" }],
    version: [{ value: p.device.firmware }],
    patient: ref(patient),
    property: [{ type: { text: "Sample rate" }, valueQuantity: [qty(p.device.sampleRateHz, "Hz")] }],
  };
  const condition: Res = {
    resourceType: "Condition",
    id: `cond-${p.id}`,
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
    code: { text: p.condition },
    bodySite: [{ text: `${p.affectedSide} side` }],
    subject: ref(patient),
    note: [{ text: `Goal: ${p.goal}` }],
  };
  const consent: Res = {
    resourceType: "Consent",
    id: `consent-${p.id}`,
    status: "active",
    scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy" }] },
    category: [{ coding: [{ system: "http://loinc.org", code: "59284-0", display: "Patient Consent" }] }],
    patient: ref(patient),
    dateTime: p.consent.updatedAt,
    policyRule: { text: p.retentionPolicy },
    provision: {
      type: "permit",
      purpose: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "TREAT", display: "treatment" }],
      provision: [
        {
          type: p.consent.researchDeidentified ? "permit" : "deny",
          purpose: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "HRESCH", display: "healthcare research" }],
        },
        {
          type: p.consent.careTeamAccess ? "permit" : "deny",
          actor: [{ role: { text: "Care team (same clinic)" }, reference: ref(org) }],
        },
      ],
    },
  };
  entries.push(patient, org, ...practitioners, device, condition, consent);

  const encounters = new Map<string, Res>();
  for (const s of b.sessions) {
    const enc: Res = {
      resourceType: "Encounter",
      id: `enc-${s.id}`,
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: s.location === "clinic" ? "AMB" : "HH",
        display: s.location === "clinic" ? "ambulatory" : "home health",
      },
      subject: ref(patient),
      period: { start: s.startedAt },
      ...(s.clinicianId ? { participant: [{ individual: { reference: `Practitioner/${s.clinicianId}` } }] } : {}),
      ...(s.notes ? { extension: [{ url: `${LOCAL}/session-note`, valueString: s.notes }] } : {}),
    };
    encounters.set(s.id, enc);
    entries.push(enc);
    if (s.painScore != null) {
      entries.push({
        resourceType: "Observation",
        id: `pain-${s.id}`,
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "72514-3", display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported" }] },
        subject: ref(patient),
        encounter: ref(enc),
        effectiveDateTime: s.startedAt,
        valueInteger: s.painScore,
      });
    }
  }

  for (const r of b.recordings) {
    entries.push(await observationFor(r, encounters.get(r.sessionId)!, patient, device, getSignal, opts.includeRaw));
  }

  const provenance: Res = {
    resourceType: "Provenance",
    id: `prov-${randomUUID()}`,
    target: entries.map(ref),
    recorded: new Date().toISOString(),
    agent: [{ type: { text: "assembler" }, who: { display: `MyoCare export (requested by ${opts.generatedBy})` } }],
    reason: [{ text: opts.share ? `Shared with ${opts.share.recipient}: ${opts.share.purpose}` : "Patient record export" }],
  };
  entries.push(provenance);

  return {
    resourceType: "Bundle",
    id: randomUUID(),
    meta: { lastUpdated: new Date().toISOString() },
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries.map((r) => ({ fullUrl: `urn:uuid:${r.resourceType}-${r.id}`, resource: r })),
  };
}

async function observationFor(
  r: Recording,
  enc: Res,
  patient: Res,
  device: Res,
  getSignal: (id: string) => Promise<SignalData | null>,
  includeRaw: boolean,
): Promise<Res> {
  const m = r.metrics;
  const comp = (code: string, display: string, value: Record<string, unknown>) => ({
    code: { coding: [{ system: LOCAL, code, display }] },
    ...value,
  });
  const components: unknown[] = [
    comp("exercise", "Exercise", { valueString: EXERCISES[r.exercise].name }),
    comp("set-number", "Set number", { valueInteger: r.setNumber }),
    comp("reps-detected", "Repetitions detected", { valueInteger: m.repsDetected }),
    comp("peak-envelope", "Peak envelope amplitude", { valueQuantity: qty(m.peakEnvelope, "mV") }),
    comp("mean-envelope", "Mean envelope amplitude (active)", { valueQuantity: qty(m.meanEnvelope, "mV") }),
    comp("rms", "RMS amplitude (active)", { valueQuantity: qty(m.rms, "mV") }),
    comp("iemg", "Integrated EMG", { valueQuantity: qty(m.iemg, "mV.s") }),
    comp("median-frequency", "Median power frequency", { valueQuantity: qty(m.medianFreqHz, "Hz") }),
    comp("fatigue-index", "Fatigue index (last vs first reps)", { valueQuantity: qty(m.fatigueIndex, "%") }),
  ];

  const sig = await getSignal(r.id);
  if (sig) {
    const env = resampleMean(sig.envelope, sig.sampleRateHz, 100);
    components.push(
      comp("envelope-waveform", "EMG envelope waveform (100 Hz)", {
        valueSampledData: { origin: qty(0, "mV"), period: env.dt * 1000, dimensions: 1, data: env.y.join(" ") },
      }),
    );
    if (includeRaw) {
      const period = 1000 / sig.sampleRateHz;
      const enc = (a: Float32Array) => Array.from(a, (v) => Math.round(v * 1e5) / 1e5).join(" ");
      components.push(
        comp("raw-waveform", "Raw surface EMG waveform", { valueSampledData: { origin: qty(0, "mV"), period, dimensions: 1, data: enc(sig.raw) } }),
        comp("rectified-waveform", "Rectified EMG waveform", { valueSampledData: { origin: qty(0, "mV"), period, dimensions: 1, data: enc(sig.rectified) } }),
      );
    }
  }

  return {
    resourceType: "Observation",
    id: r.id,
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "exam", display: "Exam" }] }],
    code: { coding: [{ system: LOCAL, code: "semg-exercise-set", display: "Surface EMG during exercise set" }], text: "Surface EMG exercise set" },
    subject: { reference: `Patient/${patient.id}` },
    encounter: { reference: `Encounter/${enc.id}` },
    effectiveDateTime: r.recordedAt,
    device: { reference: `Device/${device.id}` },
    bodySite: { text: `${r.muscle}, ${r.side}` },
    note: r.source === "synthetic" ? [{ text: "Synthetic demo data." }] : undefined,
    component: components,
  };
}
