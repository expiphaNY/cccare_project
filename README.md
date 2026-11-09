# MyoCare: EMG dashboard for patients and clinicians

A dashboard for surface‑EMG rehab data. The microcontroller sends three signals for every exercise set: **raw EMG**, **rectified**, and **envelope**. MyoCare shows the data at several levels of detail. You can start from a simple progress view and go down step by step to the raw samples. Every view, share and export is logged, and the patient can see that log.

> **Demo build.** All patients and recordings are synthetic. The generator is seeded, so the demo looks the same on every machine. Authentication is mocked (see *Before real patient data*).

## Run it

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

With no configuration, data lives in `web/.data/store.json`. That store is seeded on first run. Delete the folder to reset the demo.

### Use MongoDB

```bash
# web/.env.local
MONGODB_URI="mongodb+srv://user:pass@cluster.example.mongodb.net"
MONGODB_DB="myocare"          # optional, default "myocare"
MONGODB_SEED="true"           # seed demo data into an empty database (default true)
DEVICE_INGEST_KEY="change-me" # bearer token for the microcontroller upload API
```

If `MONGODB_URI` is set, the app uses `src/lib/store/mongo.ts`. It creates its indexes, and if the database is empty it seeds the demo patients.

## Where things are

| Page | Who | What |
|---|---|---|
| `/` | everyone | Choose the clinician or patient view |
| `/doctor` | clinician | Patient list with search, a status filter (improving / plateau / declining), sparklines, and patients who need attention |
| `/doctor/patients/:id` | clinician | Patient record. Tabs: **Overview** (exercise cards, trend chart with 6 metrics, recent sessions, notes, access log) · **Sessions** · **Compare** · **Sharing & privacy** |
| `/doctor/patients/:id/sessions/:sid?set=` | clinician | Session → set → three synced channel charts (zoom, jump to a rep) → raw sample table and CSV download |
| `/patient/:id` | patient | Plain‑language progress, "start vs now", who can see your data, clinician notes |
| `/patient/:id/compare` | patient | The same comparison tool, worded for patients |
| `/patient/:id/privacy` | patient | **My data**: what's collected, how it travels, the full access log, share links, consent switches, downloads, and deleting the profile |
| `/share/:token` | recipient | Read‑only interactive record for an outside clinic. The link expires, can be revoked, and every opening is logged |
| `/data-handling` | everyone | Data‑handling policy and the sharing standards used |

### From overview to raw data

Profile → Session → Set → Raw signal. A "depth ladder" badge and breadcrumbs show which level you're on. Clicking a point on the trend chart opens that session. Picking a set opens its signals. The bottom of the session page has the raw samples.

### Comparison tool

1. Choose an exercise.
2. Pick up to 6 days. A quick pick works too: *Baseline vs latest*, *Progression (5 points)*, *Best vs latest*, *Last 2 sessions*.
3. Choose a channel (envelope / rectified / raw), a time window (**average rep**, where reps are lined up at their start and averaged, or **whole set**) and a scale (mV, or % of the first selection).

Each selection keeps its colour for as long as it stays selected. The legend lists selections in date order, and hovering one highlights its curve. A summary table and a plain‑language sentence give the change.

## Data model (MongoDB collections)

| Collection | Key fields |
|---|---|
| `patients` | identity, condition, side, exercises, assigned clinician, `consent{careTeamAccess, patientSharing, researchDeidentified}`, device, storage region, retention policy |
| `sessions` | `patientId`, `startedAt`, `location` (clinic/home), notes, pain 0–10 |
| `recordings` | one per **set**: `patientId`, `sessionId`, **`exercise`**, **`setNumber`**, **`recordedAt`** (date + time), sample rate, computed `metrics` |
| `signals` | one per set: `raw`, `rectified`, `envelope` as float32 BinData (about 100 KB per channel for a 25 s set at 1 kHz) |
| `shares` | token, recipient, purpose, scope (full / sessions), includeRaw, expiry, revokedAt, access count |
| `audit_events` | who (role + name), what, when, detail. Shown to the patient as is |
| `deletion_receipts` | SHA‑256 of the patient id, timestamp, counts. **No health data** |

Metrics for each set (`src/lib/signal.ts`): peak and mean envelope (counting only samples above 15% of peak), RMS, integrated EMG, median frequency (Welch method, 512‑sample Hann windows), a fatigue index (last reps vs first reps), rep detection with hysteresis, and peak plus median frequency for each rep.

## Microcontroller upload API

```http
POST /api/ingest
Authorization: Bearer $DEVICE_INGEST_KEY
Content-Type: application/json

{ "deviceId": "MS-001-3189", "patientId": "p-001", "exercise": "bicep-curl", "setNumber": 1,
  "recordedAt": "2026-11-08T15:04:00Z", "sampleRateHz": 1000,
  "raw": [ ... mV ... ], "rectified": [ ... ], "envelope": [ ... ] }
```

`rectified` and `envelope` are optional. The server derives them if they're missing. The device must be paired with the patient. Device keys can only write data, never read it. The response contains the computed metrics.

## Sharing and the standards behind it

| Format | Endpoint | Standard |
|---|---|---|
| Interactive link | `/share/:token` | Capability URL with an expiry, can be revoked, every open logged |
| Interactive HTML file | `/api/export/html` | One self‑contained file (uPlot inlined, data embedded) that works offline |
| PDF | `/api/export/pdf` | Summary, trend chart, baseline vs latest overlay, full history, notes, where the data came from, access log |
| FHIR R4 bundle | `/api/export/fhir` | **HL7 FHIR R4** `Bundle` (collection): Patient, Practitioner, Organization, Device, Condition, Consent, one Encounter per session, one Observation per set (metrics as components, envelope waveform as **SampledData**), a pain Observation (LOINC 72514‑3), and a Provenance record. Add `&raw=1` to include the raw and rectified waveforms |
| CSV (one set) | `/api/export/csv?rid=` | Every sample from all 3 channels, with a header line |

Every export takes either `?patient=<id>&as=clinician|patient` or `?token=<share>`, and every export is written to the access log.

Related standards:

- **FHIR waveforms**: SampledData as used by HL7's Personal Health Device and Point‑of‑Care Device guides. FHIR has no EMG‑specific profile yet, so the metric codes come from a declared local code system. A terminology review should map them to standard codes.
- **DICOM Electromyogram Waveform** (Supplement 217, Neurophysiology Waveforms): suggested next step for archiving raw EMG in hospital PACS.
- **EDF/EDF+**: the format research tools use for biosignals. Suggested next step for exporting raw data.
- **FHIR `Patient/$everything`**: the full‑profile export follows the same pattern.

## Privacy and transparency built in

- **Access log the patient can see**: every view, signal fetch, comparison, export, share, consent change and upload.
- **Who can see your data**: a plain list, worked out from the assigned clinician, the care‑team consent setting, and active share links.
- **Share links**: each one names its recipient, expires after 24 h to 90 days, can be revoked instantly, leaves out raw signals unless you include them, and counts how often it's opened.
- **Consent switches**: care‑team access, patient sharing, and de‑identified research (off by default). Every change is logged.
- **Delete**: before deleting, you're prompted to export a copy, and you must type the patient's name to confirm. The delete is permanent and covers every collection. Afterwards you get a deletion receipt with no health data.
- No patient data is cached or prerendered. Pages are rendered at request time, and API responses are sent with `Cache-Control: private, no-store`.

## Before real patient data

1. **Real authentication.** `src/lib/access.ts` currently trusts an `as=` query parameter. Replace it with OIDC/SAML login and role claims: clinicians must be on the patient's care team, and patients may only read their own record.
2. Turn on MongoDB **Queryable Encryption / CSFLE** for identifiers (name, DOB, MRN). Allow TLS connections only, and use a database user with only the permissions it needs.
3. Give each device its own key (instead of one shared `DEVICE_INGEST_KEY`), with a way to rotate them.
4. Have the clinic confirm its legal retention rules (PHIPA, HIPAA, GDPR…). Some jurisdictions require records to be kept even after the patient asks for deletion.
5. Map the local EMG codes to LOINC/SNOMED, and validate the FHIR bundle against a FHIR validator.

## Tech

Next.js 16 (App Router, Cache Components) · React 19 · Tailwind CSS 4 · uPlot (handles 30k‑point raw signals) · pdf‑lib · MongoDB driver 7. The design follows Apple's HIG: system font, translucent chrome, a blue‑and‑white palette, a mobile bottom tab bar, `prefers-reduced-motion` and reduced‑transparency support, and visible keyboard focus.
