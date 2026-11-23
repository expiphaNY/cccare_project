# MyoCare: EMG dashboard for patients and clinicians

A dashboard for surface‑EMG rehab data. The sensor board only measures (`firmware/MyoCareBLE`). For the muscle it streams every **raw EMG** reading at 500 Hz, untouched, and the website parses and cleans it itself (`src/lib/emg-filter.ts`) into raw, rectified and envelope channels, with no threshold or filter on the board. For the arm it sends the accelerometer's x/y/z exactly as the chip reports them, and the website cleans them and works out the arm angle (`src/lib/motion.ts`). The MyoWare's own hardware envelope is sent too, as a back-up for boards that stream no raw. MyoCare shows the data at several levels of detail. You can start from a simple progress view and go down step by step to the raw samples. Every view, share and export is logged, and the patient can see that log.

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

## Host the demo on GitHub Pages

GitHub Pages only serves static files, so it can't run the full app (API routes, server actions, MongoDB). Instead the repo publishes a **static, read‑only demo**: the same UI on the built‑in synthetic data. Signals are regenerated in the browser. Writes (new patient, notes, sharing, consent, deleting, saving a recording) and server‑made exports (PDF, HTML, FHIR, CSV) are switched off. It never connects to MongoDB and never reads `.env.local` data into the pages.

**One‑time setup**

1. Push this repo to GitHub. The workflow in `.github/workflows/deploy-pages.yml` assumes the repo root is this `web/` folder (where `package.json` lives). If you put `web/` inside a bigger repo, add `defaults: run: working-directory: web` to the build job and prefix the cache and artifact paths with `web/`.
2. In the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow from the Actions tab). The site appears at `https://<user>.github.io/<repo>/`.

The workflow sets the sub‑path from the repo name automatically (`<user>.github.io` repos are served from the root).

**Try it locally**

```bash
cd web
NEXT_PUBLIC_BASE_PATH=/care_project npm run build:pages   # writes web/out
```

Serve `out/` under that same sub‑path to check it, for example by putting it in a folder called `care_project` and running `python3 -m http.server` one level up, then opening `http://localhost:8000/care_project/`.

Notes: dates like "expires in 23 days" and "3 days ago" are fixed at build time, so re‑run the workflow now and then. Everything under `web/src/lib/demo/` and the `DEMO` flag in `web/src/lib/demo.ts` exists only for this build; `npm run dev` and `npm run build` are unchanged.

## Where things are

| Page | Who | What |
|---|---|---|
| `/` | everyone | Landing page → clinician dashboard (the app is clinician-only; there is no patient view) |
| `/doctor` | clinician | Patient list with search, a status filter (improving / plateau / declining), sparklines, and patients who need attention |
| `/doctor/patients/:id` | clinician | Patient record. Tabs: **Overview** (exercise cards, load & rep-quality card with the prescribed working weight, trend chart with 6 metrics, recent sessions, notes, access log) · **Sessions** · **Compare** · **Drafts** · **Sharing & privacy** |
| `/doctor/patients/:id/sessions/:sid?set=` | clinician | Session → set → three synced channel charts (zoom, jump to a rep) → accelerometer (smoothed / raw) → **rep cross-check** (EMG vs movement, per-rep table) → raw sample table and CSV download |
| `/doctor/patients/:id/record` | clinician | Live measurement from a MyoWare sensor over Bluetooth, with a session name (default: the date) and a typed weight per set (any number, kg or lb), plus live EMG + movement rep counters (see below) |
| `/doctor/suggestions` | clinician | **Drafts**: session notes and working-weight changes written by MyoMinion, applied only on approval |
| `/share/:token` | recipient | Read‑only interactive record for an outside clinic. The link expires, can be revoked, and every opening is logged |
| `/data-handling` | everyone | Data‑handling policy and the sharing standards used |

### MyoMinion

The **MyoMinion** button (all doctor pages) runs an agent loop against a local LM Studio server (`LMSTUDIO_URL`, default `localhost:1234`). It only does work that takes a clinician more than a couple of clicks; every number comes from deterministic tools in `src/lib/agent/tools.ts` (7 tools):

- **Session wrap-up** (the **Wrap up with MyoMinion** button on a session page): the server prefetches `review_session`, the model gets only 3 tools and a fixed SOAP procedure, drafts the note with `draft_session_note`, and calls `propose_load_change` only when the progression rules say increase or decrease.
- **review_patient**: a brief condensed from every session (trend, weights with the next-weight recommendation, rep quality, shakiness by weight, pain, notes).
- **triage_caseload**: every patient sorted into action lists (ready to move up, should drop back, declining, reps not verified, shakier with weight, inactive).
- `get_current_view` and `highlight` for "this session" and pointing at a rep.

Drafts change nothing until approved in Drafts. `draft_session_note` rejects a note containing any number that is not in the session review, naming the numbers, so the model rewrites it. Six eval tasks (Debug toggle) grade runs automatically; task 6 is the wrap-up.

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

## Live measurement (MyoWare over Bluetooth)

`/patient/:id/record` and `/doctor/patients/:id/record` ("Start new measurement" / "New measurement") stream a **MyoWare 2.0 Wireless Shield** straight into the browser. No Arduino IDE or Node bridge is needed. It works in **Chrome or Edge** on a computer, over `https://` or `http://localhost`. It doesn't work in Safari, Firefox, or browsers built into other apps; the page detects these and offers to copy the link.

**Firmware:** upload [`../firmware/MyoCareBLE/MyoCareBLE.ino`](../firmware/MyoCareBLE/MyoCareBLE.ino) to the shield with the Arduino IDE. Use board *SparkFun ESP32 Thing Plus* (esp32 core 3.3.x); no extra libraries are needed. It advertises as `MyoWareSensor1` and sends `Muscle:<ENV ADC>` plus a batch of raw EMG readings (`Fs:500,Raw:…`, about 10 per line) 50 times a second over Bluetooth LE, with the same UUIDs as the MyoWare library. If an external I²C / STEMMA QT accelerometer is connected (tried on SDA 21 / SCL 22 first, then any pins with pull-ups), the sketch detects it at start-up and adds `Accel_X/Y/Z` in g to each line, exactly as the chip reports them. The muscle part of every line is packed first, so the accelerometer can never push raw EMG readings out of a small Bluetooth packet (`sh firmware/bench/run.sh` tests this on a laptop). Supported chips: MPU‑6050/6500/9250, ICM‑20948, ADXL345/343, LIS3DH/LIS2DH12, LSM6DS3/DSL/DSO, ISM330DHCX, and MMA845x. It restarts advertising after a disconnect, and its LED blinks while waiting and stays solid once connected. This matches the default **Bluetooth LE** connection, so Chrome or Edge connect directly, with no pairing and no server bridge, on localhost or any HTTPS deployment.

There are three ways to connect (**Advanced sensor settings → Connection**):

| | Through this computer | Chrome Web Serial | Bluetooth LE (default) |
|---|---|---|---|
| Use when | An older Bluetooth Classic serial sketch, shown in **macOS Bluetooth settings** as e.g. `MyoWare_Shield`, type "PDA" | Same shield, if Chrome can open it | `firmware/MyoCareBLE` or the MyoWare library's `MyoWareBLEPeripheral` example (`MyoWareSensor1`) |
| How | The Next.js server reads `/dev/cu.MyoWare_Shield` (`GET /api/sensor/ports`, `GET /api/sensor/stream?port=`) and streams the lines to the page | The browser opens the port itself | Web Bluetooth (service `ec3af789-…e930`, characteristic `f3a56edf-…1308`) |
| Works in | Any browser, but **only on localhost** (the server must be the Mac the sensor is paired with) | Chrome/Edge. On macOS, Chrome opens Bluetooth serial over its own link, and that failed for the shield ("Failed to open serial port") | Chrome/Edge |
| Setup | **Pair first** in System Settings → Bluetooth, then click Connect | Pair first, then pick `MyoWare_Shield` | Don't pair it in macOS: a connected device stops advertising |
| Data seen | `Muscle:3883,Accel_X:0.00,Accel_Y:0.00,Accel_Z:0.00` at about 45 lines/s | same | One ASCII number per notification, about 30–90/s |

The bridge (`src/lib/server/serial-bridge.ts`) opens the port once and sets it to raw mode with `stty raw -echo clocal`. It keeps one reader per port and stops it when the page disconnects. Requests whose `Host` isn't localhost are refused, so a deployed site can't read the server's ports.

Steps:

1. Click **Connect sensor**. The page shows each step and explains any failure.
2. Pick the exercise, location, pain score and the **weight** for the set (chips from the clinic list, or a custom value; it starts at the patient's prescribed weight), then click **Start set**. You see the live value, a 10 s chart, set time, live **EMG reps** and **movement reps** (green when they match), the arm angle and the set peak.
3. **Stop set** keeps the set. Add more sets or remove some, then click **Finish & save session**. Nothing is stored before that. Saving creates one session with one recording per set and writes to the access log.
4. **Try with a demo sensor** simulates the board, so you can test without hardware.

The line parser (`parsePacket` in `src/lib/ble.ts`) accepts labelled lines (`Muscle:` / `emg=` / `Accel_X:` …) or plain numbers (`1834` or `emg,ax,ay,az`), plus an optional batch of raw readings (`Fs:500,Raw:12 -3 5 …`). A line it cannot read is skipped, so one bad packet cannot crash the stream. Values are treated as 12‑bit ADC counts and converted to **millivolts at the electrodes**, using the same formula as the MyoWare library: `counts × 3.3 V / 4095 ÷ gain`, where envelope gain = 200 × (1 + gain knob kΩ). The default knob setting is 50 kΩ, which gives a gain of 10 200. The browser then resamples to 100 Hz and posts to `POST /api/record`. If the reading sits near 4095, the page warns that the electrode contact or gain is likely the problem.

- **Envelope‑only:** when the firmware does not stream raw, recordings are stored with `channels: ["envelope"]`. RMS and median frequency are hidden, left out of trends, and left out of FHIR exports, because they need raw EMG at ≥200 Hz.
- **Accelerometer:** raw x/y/z saved as `signals.motion{x,y,z}` exactly as the chip sent them (only when it sends non‑zero values) and included in CSV exports. The site cleans them itself in `src/lib/motion.ts`: block‑median decimation to ~50 Hz and a median‑of‑5 remove Bluetooth glitches, then a zero‑phase 3 Hz Butterworth low‑pass (forwards + backwards, so movement timing stays aligned with the EMG). The arm angle is measured from the rest orientation (the end of the movement range where EMG is quiet) and reps are counted above 50 % of the set's range (≥ 8°, ≥ 0.5 s). A set with no accelerometer is counted from the muscle alone and marked **EMG only**.
- **Rep cross-check:** `src/lib/rep-verify.ts` counts reps from the EMG envelope (robust-threshold hysteresis) and from the arm angle, matches them by time overlap, and stores `recordings.repCheck` (`verified` / `partial` / `mismatch` / `no-motion`, EMG reps, movement reps, verified reps, agreement, mean ROM, EMG-to-movement onset offset, per-rep list, filter settings). EMG-only reps usually mean a partial or isometric rep; movement-only reps suggest momentum or poor electrode contact.
- **Weights:** there is no fixed weight list. The clinician types any weight (0 to 200) and picks kg or lb; each recording stores `load {value, unit, kg}` in MongoDB (the kg value lets sets in different units be compared), and patients store `prescribedLoad` the same way. The assistant steps weights by a small dumbbell increment in the unit last used (`loadStep` in `src/lib/types.ts`).
- **Session names:** each session stores `name`, built as what the clinician typed (or the date) followed by ` · ` and the start time, e.g. `Elbow week 3 · 4:35 p.m.`. It can be renamed on the session page.
- **Shakiness (tremor):** `src/lib/tremor.ts` measures 3–12 Hz shake (voluntary curls sit below ~2 Hz). Glitches are removed with a Hampel filter (the rep path's medians would erase tremor, which is why the raw x/y/z are kept), then a zero-phase band-pass. The headline number is the RMS while the arm holds still at the top of the curl (postural tremor, milli-g): steady < 5, mild < 15, moderate < 50, marked ≥ 50 (heuristic). Also stored in `recordings.tremor`: rest and moving RMS, the **off-axis** RMS along the elbow's rotation axis (found by PCA; the curl barely moves it, so it's a clean check that the shake is real), dominant frequency and rhythmicity (8–12 Hz = physiological, 4–7 Hz = slower, typical of neurological tremor), hold shake per rep, change across the set (fatigue), and whether the sensor's packet rate (needs ≥ 24 Hz) can resolve 12 Hz. Shown on the session page, live in the recorder, on the patient overview (per session and by weight), used by MyoMinion's `analyze_shakiness`, and as a rule in the weight recommendation.
- Recordings made this way get `source: "ble"`, plus `capture{transport: web-serial|web-bluetooth|demo, deviceName, observedRateHz, samplesReceived, gain}`.

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
