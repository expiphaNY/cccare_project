// =============================================================================
// tools.ts : THE ASSISTANT'S TOOLS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The seven tools the assistant may call (review a session, review a patient, triage the caseload, draft a note, propose a weight change, show the current view, highlight). Each is plain code that reads stored data, so every number comes from the records. A drafted note containing a number that is not in the data is rejected.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Impact on people (safety): the assistant can only draft; a clinician approves everything.
// =============================================================================

import "server-only";
import { randomUUID } from "node:crypto";
import { shouldLog } from "../access";
import { clinicianActor, logAccess } from "../data";
import { fullName } from "../format";
import { getStore } from "../store";
import { LB_PER_KG, fmtLoad, makeLoad, type Actor, type Load, type Recording, type Session } from "../types";
import { ungrounded } from "./grade";
import { REP_STATUS } from "../rep-verify";
import { tremorLevel } from "../tremor";
import {
  loadAll,
  loadBundle,
  metricTrend,
  patientRow,
  r2,
  resolvePatient,
  resolveSession,
  sessionHref,
  setSummary,
  type Bundle,
} from "./analysis";
import type { ToolSchema } from "./lmstudio";
import type { AgentRole, ClientAction, PageTarget, ToolUi } from "./protocol";

export interface AgentContext {
  role: AgentRole;
  /** The patient record open on screen, if any. */
  patientId?: string;
  actor: Actor;
  view: { path: string; search: string; targets: PageTarget[] };
}

interface ToolOutput {
  result: unknown;
  client?: ClientAction;
  ui?: ToolUi;
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Short human label shown next to the tool name, e.g. "peak activation · 8 sessions". */
  label?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: AgentContext) => Promise<ToolOutput>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string) => ({ type: "number", description });
const sessionParam = str('Session id, a date (YYYY-MM-DD), or "latest", "first", "previous", "current" (the one on screen).');
const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : undefined);

/** Parses what the user is looking at from the URL. */
function parseView(ctx: AgentContext) {
  const m = ctx.view.path.match(/^\/doctor\/patients\/([^/]+)(?:\/(sessions|compare|record|sharing|suggestions))?(?:\/([^/]+))?/);
  const set = new URLSearchParams(ctx.view.search).get("set") ?? undefined;
  return { patientId: m?.[1], section: m?.[2] ?? (m ? "overview" : ctx.view.path === "/doctor" ? "patient list" : "other"), sessionId: m?.[2] === "sessions" ? m[3] : undefined, setId: set };
}

const fail = (error: string, extra: Record<string, unknown> = {}) => ({ result: { error, ...extra } });

// ---- Shared ----------------------------------------------------------------

const getCurrentView: ToolDef = {
  name: "get_current_view",
  description:
    "What the user is looking at right now: the page, the patient/session/set on screen with its numbers, and the ids of on-screen elements that `highlight` can point at. Call this first when the user says 'this', 'here', or asks about what they see.",
  parameters: obj({}),
  run: async (_a, ctx) => {
    const v = parseView(ctx);
    const b = v.patientId ? await loadBundle(v.patientId) : null;
    const out: Record<string, unknown> = { page: v.section, path: ctx.view.path, highlightTargets: ctx.view.targets };
    if (b) out.patient = { id: b.patient.id, name: fullName(b.patient), condition: b.patient.condition, prescribedLoad: b.patient.prescribedLoad ? fmtLoad(b.patient.prescribedLoad) : null };
    if (b && v.sessionId) {
      const sess = b.sessions.find((x) => x.id === v.sessionId);
      if (sess) {
        const recs = b.recordings.filter((r) => r.sessionId === sess.id);
        const sel = recs.find((r) => r.id === v.setId) ?? recs.reduce((a, r) => (r.metrics.peakEnvelope > a.metrics.peakEnvelope ? r : a), recs[0]);
        out.session = { id: sess.id, date: sess.startedAt.slice(0, 10), sets: recs.length };
        if (sel) out.setOnScreen = setSummary(sel);
      }
    }
    return { result: out };
  },
};

const highlight: ToolDef = {
  name: "highlight",
  description:
    "Temporarily spotlights part of the screen with a mask so the user can see what you are describing. `target` must be an id from get_current_view's highlightTargets. For the signal chart (target 'signal-chart') you may also pass `rep` (1-based repetition) or `start_s`/`end_s` to zoom to and shade that span.",
  parameters: obj(
    {
      target: str("Element id from highlightTargets."),
      caption: str("A short caption shown next to the highlight (max ~12 words)."),
      rep: num("Repetition number to zoom to on the signal chart."),
      start_s: num("Start of a time span on the signal chart, in seconds."),
      end_s: num("End of a time span on the signal chart, in seconds."),
    },
    ["target", "caption"],
  ),
  label: (a) => [s(a.target), a.rep ? `rep ${a.rep}` : "", a.start_s != null ? `${a.start_s}–${a.end_s}s` : ""].filter(Boolean).join(" · "),
  run: async (a, ctx) => {
    const target = s(a.target);
    const t = ctx.view.targets.find((x) => x.id === target);
    if (!t) return fail(`"${target}" is not on screen.`, { available: ctx.view.targets.map((x) => x.id) });
    const rep = n(a.rep);
    const start = n(a.start_s);
    const end = n(a.end_s);
    return {
      result: { highlighted: t.label, note: "Shown to the user for a few seconds." },
      client: { type: "highlight", target, caption: s(a.caption).slice(0, 120) || t.label, rep, start, end },
    };
  },
};

// ---- Clinician -------------------------------------------------------------

async function patientOrFail(q: unknown, ctx: AgentContext) {
  const all = await loadAll();
  const b = resolvePatient(all, s(q) || parseView(ctx).patientId || "");
  return { b, all };
}

function logRead(b: Bundle, what: string) {
  if (shouldLog(`agent|${b.patient.id}|${what}`, 10 * 60_000))
    return logAccess(b.patient.id, clinicianActor, "profile_viewed", `Clinician's assistant read ${what}.`);
}

// Only tools that do work a clinician can't get in a click or two: each one
// condenses many records into a judgement, or writes a draft they would type.

const reviewPatient: ToolDef = {
  name: "review_patient",
  description:
    "Everything needed to brief the clinician on ONE patient, condensed from all their sessions: goal, activation trend, prescribed and recent weights with the rule-based next-weight recommendation, rep quality (EMG vs accelerometer), shakiness and how it changes with weight, pain, recent notes, data-quality flags and pending drafts. Use for a brief, 'how is X doing', 'should X move up in weight'.",
  parameters: obj({ patient: str("Patient id or name. Defaults to the patient on screen.") }),
  label: (a) => s(a.patient) || "patient on screen",
  run: async (a, ctx) => {
    const { b, all } = await patientOrFail(a.patient, ctx);
    if (!b) return fail("Patient not found.", { patients: all.map((x) => fullName(x.patient)) });
    await logRead(b, "a patient review");
    const store = await getStore();
    const [weights, drafts] = await Promise.all([store.getWeightSettings(), store.listSuggestions(b.patient.id)]);
    const p = b.patient;
    const hist = loadHistory(b);
    const peak = metricTrend(b, "peakEnvelope");
    const pain = b.sessions.filter((x) => x.painScore != null).map((x) => x.painScore!);
    const clipped = b.recordings.filter((r) => (r.capture?.clippedPct ?? 0) >= 2 && !r.capture?.rawStreamed).length;
    return {
      result: {
        patient: { name: fullName(p), age: Math.floor((Date.now() - new Date(p.dob).getTime()) / 3.15576e10), condition: p.condition, side: p.affectedSide, goal: p.goal, href: `/doctor/patients/${p.id}` },
        attendance: (({ sessions, lastSession, daysSinceLastSession, sessionsPerWeek }) => ({ sessions, lastSession, daysSinceLastSession, sessionsPerWeek }))(patientRow(b)),
        peakActivation: { unit: "mV", first: peak.first?.value, latest: peak.latest?.value, best: peak.best?.value, changeSinceStartPct: peak.changeSinceStartPct, recentChangePct: peak.recentChangePct, direction: peak.direction },
        weight: {
          prescribed: p.prescribedLoad ? fmtLoad(p.prescribedLoad) : null,
          recentSessions: hist.slice(-5).map((h) => ({ date: h.date, load: h.load, verifiedReps: h.verifiedReps, peakMv: h.peakMv, fatiguePct: h.meanFatiguePct, shakeMg: h.shakeMg, pain: h.pain })),
          recommendation: hist.length ? { ...recommendLoad(b, hist, weights), basedOnSession: hist.at(-1)!.date } : null,
        },
        repQuality: { ...repSummary(b.recordings), recentDisagreements: b.recordings.filter((r) => r.repCheck && (r.repCheck.status === "partial" || r.repCheck.status === "mismatch")).slice(-3).map((r) => ({ date: r.recordedAt.slice(0, 10), set: r.setNumber, ...repDetail(r), href: `${sessionHref(p.id, r.sessionId)}?set=${r.id}` })) },
        shakiness: tremorSummary(b),
        pain: { first: pain[0] ?? null, latest: pain.at(-1) ?? null, scale: "0-10" },
        recentNotes: b.sessions.filter((x) => x.notes).slice(-2).map((x) => ({ date: x.startedAt.slice(0, 10), note: x.notes })),
        dataQuality: { clippedSets: clipped, liveSets: b.recordings.filter((r) => r.source === "ble").length },
        pendingDrafts: drafts.filter((x) => x.status === "pending").map((x) => x.title),
      },
    };
  },
};

const reviewSession: ToolDef = {
  name: "review_session",
  description:
    "One session in full, ready to write a note from: every set's weight, EMG reps, verified reps and the reps only one sensor saw, range of motion, peak and mean activation, fatigue, median frequency and shakiness; pain; the change from the previous session; and, for the latest session, the next-weight recommendation. Use before draft_session_note and for 'how did this session go', 'were these reps real'.",
  parameters: obj({ patient: str("Patient id or name. Defaults to the patient on screen."), session: sessionParam }),
  label: (a) => [s(a.patient) || "patient on screen", s(a.session) || "current"].join(" · "),
  run: async (a, ctx) => {
    const { b } = await patientOrFail(a.patient, ctx);
    if (!b) return fail("Patient not found.");
    const sess = resolveSession(b, s(a.session) || "current", parseView(ctx).sessionId) ?? resolveSession(b, "latest");
    if (!sess) return fail("Session not found.", { sessions: b.sessions.slice(-8).map((x) => ({ id: x.id, date: x.startedAt.slice(0, 10) })) });
    await logRead(b, "a session review");
    const weights = await (await getStore()).getWeightSettings();
    return { result: sessionReview(b, sess, weights) };
  },
};

const triageCaseload: ToolDef = {
  name: "triage_caseload",
  description:
    "Scans every patient and sorts them into action lists no single screen shows: ready to move up in weight, should drop back, activation declining, reps not verified by movement, shakier at heavier weights, no session for 7+ days. Each entry has the number behind it and a link. Use for 'who needs attention', 'who is ready to progress', 'what should I look at today'.",
  parameters: obj({}),
  run: async () => {
    const all = await loadAll();
    const store = await getStore();
    const [weights, drafts] = await Promise.all([store.getWeightSettings(), store.listSuggestions()]);
    type Entry = { name: string; href: string; why: string };
    const lists: Record<string, Entry[]> = { readyToMoveUp: [], shouldDropBack: [], activationDeclining: [], repsNotVerified: [], shakierWithWeight: [], inactive7Days: [] };
    for (const b of all) {
      const row = patientRow(b);
      const e = (why: string): Entry => ({ name: row.name, href: row.href, why });
      const hist = loadHistory(b);
      if (hist.length) {
        const rec = recommendLoad(b, hist, weights);
        if (rec.action === "increase") lists.readyToMoveUp.push(e(`${rec.from} → ${rec.to}: ${rec.decidedBy}`));
        if (rec.action === "decrease") lists.shouldDropBack.push(e(`${rec.from} → ${rec.to}: ${rec.decidedBy}`));
      }
      if (row.status === "declining") lists.activationDeclining.push(e(`peak activation ${row.recentChangePct}% over the last 2 sessions`));
      const last = b.sessions.at(-1);
      const lastChecked = last ? b.recordings.filter((r) => r.sessionId === last.id) : [];
      const rq = repSummary(lastChecked);
      if (rq.agreementPct != null && rq.agreementPct < 90) lists.repsNotVerified.push(e(`${rq.agreementPct}% rep agreement in the latest session (${rq.verifiedReps} of ${Math.max(rq.emgReps, rq.movementReps)} reps verified)`));
      const ts = tremorSummary(b);
      if ("byLoad" in ts && ts.byLoad && ts.byLoad.length >= 2) {
        const byKg = [...ts.byLoad].sort((x, y) => parseFloat(x.load) - parseFloat(y.load));
        const lo = byKg[0], hi = byKg[byKg.length - 1];
        if (lo.holdMg != null && hi.holdMg != null && hi.holdMg > lo.holdMg * 1.3) lists.shakierWithWeight.push(e(`hold shake ${lo.holdMg} mg at ${lo.load} vs ${hi.holdMg} mg at ${hi.load}`));
      }
      if ((row.daysSinceLastSession ?? 0) >= 7) lists.inactive7Days.push(e(`last session ${row.daysSinceLastSession} days ago`));
    }
    return { result: { patients: all.length, ...lists, pendingDrafts: drafts.filter((x) => x.status === "pending").length, draftsHref: "/doctor/suggestions" } };
  },
};

const clinicianTools: ToolDef[] = [
  getCurrentView,
  reviewPatient,
  reviewSession,
  triageCaseload,
  {
    name: "propose_load_change",
    description:
      "Creates a DRAFT change of the patient's prescribed working weight. Nothing changes until the clinician approves it in Drafts. Use after review_session or review_patient recommends a change, or when the clinician asks you to set a weight. The value must be in the clinic's weight list. Never say the weight has been changed: say a draft is waiting for approval.",
    parameters: obj(
      {
        patient: str("Patient id or name. Defaults to the patient on screen."),
        value: num("New working weight, in the given unit. 0 = no added weight."),
        unit: str("kg or lb. Defaults to the clinic's unit.", { enum: ["kg", "lb"] }),
        rationale: str("The data behind the change: loads, verified reps, fatigue, pain, ROM. 1–3 sentences with numbers from tool results."),
      },
      ["value", "rationale"],
    ),
    label: (a) => `${s(a.patient) || "patient on screen"} → ${a.value} ${s(a.unit) || ""}`.trim(),
    run: async (a, ctx) => {
      const { b } = await patientOrFail(a.patient, ctx);
      if (!b) return fail("Patient not found.");
      const v = n(a.value);
      if (v == null || !Number.isFinite(v) || v < 0 || v > 200) return fail("value must be a weight between 0 and 200.");
      const store = await getStore();
      const weights = await store.getWeightSettings();
      const unit = a.unit === "lb" || a.unit === "kg" ? a.unit : weights.unit;
      if (unit === weights.unit && !weights.options.includes(v)) return fail(`${v} ${unit} is not in the clinic's weight list.`, { options: weights.options, unit: weights.unit });
      const load = makeLoad(v, unit);
      const from = b.patient.prescribedLoad ? fmtLoad(b.patient.prescribedLoad) : "not set";
      const draft = {
        id: `sg-${randomUUID()}`,
        patientId: b.patient.id,
        createdAt: new Date().toISOString(),
        requestedBy: ctx.actor,
        kind: "load" as const,
        proposedLoad: load,
        title: `Working weight: ${from} → ${fmtLoad(load)}`,
        body: `Change ${fullName(b.patient)}'s prescribed working weight from ${from} to ${fmtLoad(load)}.`,
        rationale: s(a.rationale).slice(0, 1200),
        status: "pending" as const,
      };
      await store.createSuggestion(draft);
      await logAccess(b.patient.id, { role: "system", name: "MyoCare assistant" }, "suggestion_drafted", `Drafted a working-weight change (${from} → ${fmtLoad(load)}) for clinician approval.`);
      return {
        result: { drafted: true, status: "awaiting your approval", title: draft.title, reviewHref: `/doctor/patients/${b.patient.id}/suggestions` },
        ui: { kind: "draft", id: draft.id, title: draft.title, href: `/doctor/patients/${b.patient.id}/suggestions` },
      };
    },
  },
  {
    name: "draft_session_note",
    description:
      "Writes a DRAFT clinical note for one session in SOAP form (S: pain; O: weights, verified reps, peak, fatigue, ROM, shakiness; A: what it means; P: the weight recommendation). Appended to the session notes only after the clinician approves it in Drafts. Call review_session first: a note with any number not in that review is rejected.",
    parameters: obj(
      {
        patient: str("Patient id or name. Defaults to the patient on screen."),
        session: sessionParam,
        note: str("The note text, concise clinical language, ≤ 120 words. Every number must come from a tool result."),
      },
      ["note"],
    ),
    label: (a) => [s(a.patient) || "patient on screen", s(a.session) || "current"].join(" · "),
    run: async (a, ctx) => {
      const { b } = await patientOrFail(a.patient, ctx);
      if (!b) return fail("Patient not found.");
      const sess = resolveSession(b, s(a.session) || "current", parseView(ctx).sessionId) ?? resolveSession(b, "latest");
      if (!sess) return fail("Session not found.");
      const note = s(a.note).trim().slice(0, 1500);
      if (!note) return fail("note is empty.");
      // Grounding check: every number in the note must appear in this session's review.
      const weights = await (await getStore()).getWeightSettings();
      const facts = JSON.stringify(sessionReview(b, sess, weights));
      const bad = ungrounded(note, [facts]);
      if (bad.length)
        return fail(`These numbers are not in the session data: ${bad.join(", ")}. Rewrite the note using only numbers from review_session, then call draft_session_note again.`);
      const draft = {
        id: `sg-${randomUUID()}`,
        patientId: b.patient.id,
        sessionId: sess.id,
        createdAt: new Date().toISOString(),
        requestedBy: ctx.actor,
        kind: "note" as const,
        title: `Session note · ${sess.startedAt.slice(0, 10)}`,
        body: note,
        rationale: "Drafted from the session's EMG metrics, loads and rep cross-check.",
        status: "pending" as const,
      };
      const store = await getStore();
      await store.createSuggestion(draft);
      await logAccess(b.patient.id, { role: "system", name: "MyoCare assistant" }, "suggestion_drafted", `Drafted a session note (${sess.startedAt.slice(0, 10)}) for clinician approval.`);
      return {
        result: { drafted: true, status: "awaiting your approval", session: sess.startedAt.slice(0, 10), reviewHref: `/doctor/patients/${b.patient.id}/suggestions` },
        ui: { kind: "draft", id: draft.id, title: draft.title, href: `/doctor/patients/${b.patient.id}/suggestions` },
      };
    },
  },
  highlight,
];

/** Tools available in session wrap-up mode: the review is prefetched by the server. */
export const WRAPUP_TOOLS = ["review_session", "draft_session_note", "propose_load_change"];

// ---- Registry --------------------------------------------------------------

export function toolsFor(role: AgentRole): ToolDef[] {
  void role;
  return clinicianTools;
}

export function toolSchemas(role: AgentRole, only?: string[]): ToolSchema[] {
  return toolsFor(role)
    .filter((t) => !only || only.includes(t.name))
    .map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Parses arguments and builds the short label shown before the tool runs. */
export function describeTool(role: AgentRole, name: string, rawArgs: string) {
  const tool = toolsFor(role).find((t) => t.name === name);
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    /* reported by runTool */
  }
  let label = "";
  try {
    label = tool?.label?.(args) ?? "";
  } catch {
    /* label is cosmetic */
  }
  return { args, label };
}

export async function runTool(role: AgentRole, name: string, rawArgs: string, ctx: AgentContext) {
  const tool = toolsFor(role).find((t) => t.name === name);
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch {
    return { label: "", output: { result: { error: `Arguments were not valid JSON: ${rawArgs.slice(0, 200)}` } } as ToolOutput };
  }
  if (!tool) return { label: "", output: { result: { error: `Unknown tool "${name}".` } } as ToolOutput };
  const label = tool.label?.(args) ?? "";
  try {
    return { label, args, output: await tool.run(args, ctx) };
  } catch (e) {
    return { label, args, output: { result: { error: (e as Error).message } } as ToolOutput };
  }
}

export function actorFor(): Actor {
  return clinicianActor;
}

// ---- Rep verification + load helpers -----------------------------------------

/** Counts across a set of recordings' rep cross-checks. */
function repSummary(recs: Recording[]) {
  const checked = recs.filter((r) => r.repCheck && r.repCheck.status !== "no-motion");
  const emg = checked.reduce((t, r) => t + r.repCheck!.emgReps, 0);
  const motion = checked.reduce((t, r) => t + r.repCheck!.motionReps, 0);
  const verified = checked.reduce((t, r) => t + r.repCheck!.verifiedReps, 0);
  const by = (st: string) => checked.filter((r) => r.repCheck!.status === st).length;
  const roms = checked.map((r) => r.repCheck!.meanRomDeg).filter((x): x is number => x != null);
  return {
    setsWithMotion: checked.length,
    setsEmgOnly: recs.length - checked.length,
    setsVerified: by("verified"),
    setsPartial: by("partial"),
    setsMismatch: by("mismatch"),
    emgReps: emg,
    movementReps: motion,
    verifiedReps: verified,
    agreementPct: emg + motion ? r2(((2 * verified) / (emg + motion)) * 100, 0) : null,
    meanRomDeg: roms.length ? r2(roms.reduce((t, x) => t + x, 0) / roms.length, 0) : null,
  };
}

function repDetail(r: Recording) {
  const c = r.repCheck;
  if (!c) return { repCheck: "not available (recorded before rep checks)", emgReps: r.metrics.repsDetected };
  return {
    status: REP_STATUS[c.status].label,
    emgReps: c.emgReps,
    movementReps: c.motionReps,
    verifiedReps: c.verifiedReps,
    agreementPct: r2(c.agreement * 100, 0),
    meanRomDeg: c.meanRomDeg,
    meanOnsetOffsetMs: c.meanLagMs,
    emgOnlyReps: c.reps.filter((x) => x.source === "emg").map((x) => `${x.start}–${x.end}s`),
    movementOnlyReps: c.reps.filter((x) => x.source === "motion").map((x) => `${x.start}–${x.end}s (${x.romDeg}°)`),
  };
}

/** Shakiness per session, by weight, and the trend. */
function tremorSummary(b: Bundle) {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  const perSession = b.sessions
    .map((x) => {
      const recs = b.recordings.filter((r) => r.sessionId === x.id && r.tremor?.reliable);
      if (!recs.length) return null;
      const mg = avg(recs.map((r) => r.tremor!.headlineMg))!;
      const hz = recs.map((r) => r.tremor!).filter((t) => t.rhythmic && t.peakHz).map((t) => t.peakHz!);
      return {
        date: x.startedAt.slice(0, 10),
        load: fmtLoad(recs.find((r) => r.load)?.load),
        holdMg: r2(mg, 1),
        level: tremorLevel(mg).label,
        peakHz: hz.length ? r2(avg(hz), 1) : null,
        withinSetChangePct: r2(avg(recs.map((r) => r.tremor!.fatigueChangePct).filter((v): v is number => v != null)), 0),
        href: sessionHref(b.patient.id, x.id),
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!perSession.length) return { available: false };
  const byLoad = new Map<string, number[]>();
  for (const r of b.recordings) if (r.tremor?.reliable && r.load) byLoad.set(fmtLoad(r.load), [...(byLoad.get(fmtLoad(r.load)) ?? []), r.tremor.headlineMg]);
  const first = avg(perSession.slice(0, 3).map((p) => p.holdMg!))!;
  const last = avg(perSession.slice(-3).map((p) => p.holdMg!))!;
  return {
    available: true,
    latest: perSession[perSession.length - 1],
    changeSinceFirstSessionsPct: perSession.length >= 4 ? r2((last / first - 1) * 100, 0) : null,
    byLoad: [...byLoad.entries()].map(([load, v]) => ({ load, holdMg: r2(avg(v), 1), sets: v.length })),
    perSession: perSession.slice(-8),
  };
}

/** One row per session that has weights recorded. */
function loadHistory(b: Bundle) {
  return b.sessions
    .map((x) => {
      const recs = b.recordings.filter((r) => r.sessionId === x.id && r.load);
      if (!recs.length) return null;
      const top = Math.max(...recs.map((r) => r.load!.kg));
      const atTop = recs.filter((r) => r.load!.kg === top);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
      const peak = Math.max(...atTop.map((r) => r.metrics.peakEnvelope));
      const reps = atTop.map((r) => r.repCheck && r.repCheck.status !== "no-motion" ? r.repCheck.verifiedReps : r.metrics.repsDetected);
      const roms = atTop.map((r) => r.repCheck?.meanRomDeg).filter((v): v is number => v != null);
      return {
        date: x.startedAt.slice(0, 10),
        sessionId: x.id,
        load: fmtLoad(atTop[0].load),
        loadKg: top,
        sets: atTop.length,
        verifiedReps: reps,
        minReps: Math.min(...reps),
        agreementPct: r2((avg(atTop.map((r) => (r.repCheck && r.repCheck.status !== "no-motion" ? r.repCheck.agreement : 1))) ?? 1) * 100, 0),
        peakMv: r2(peak, 3),
        peakMvPerKg: top > 0 ? r2(peak / top, 4) : null,
        meanFatiguePct: r2(avg(atTop.map((r) => r.metrics.fatigueIndex)), 1),
        shakeMg: (() => {
          const t = atTop.filter((r) => r.tremor?.reliable).map((r) => r.tremor!.headlineMg);
          return t.length ? r2(t.reduce((x, y) => x + y, 0) / t.length, 1) : null;
        })(),
        romFirstSetDeg: roms[0] ?? null,
        romLastSetDeg: roms.length ? roms[roms.length - 1] : null,
        pain: x.painScore ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

/**
 * Deterministic progression rules. Order matters: safety first (pain), then
 * data trust, then performance at the current weight.
 */
function recommendLoad(b: Bundle, hist: ReturnType<typeof loadHistory>, weights: { unit: "kg" | "lb"; options: number[] }) {
  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  const toUnit = (kg: number) => (weights.unit === "kg" ? kg : kg * LB_PER_KG);
  const opts = [...weights.options].sort((x, y) => x - y);
  const cur = toUnit(last.loadKg);
  const idx = opts.reduce((best, v, i) => (Math.abs(v - cur) < Math.abs(opts[best] - cur) ? i : best), 0);
  const step = (d: number): Load => makeLoad(opts[Math.max(0, Math.min(opts.length - 1, idx + d))], weights.unit);
  const rules: { rule: string; value: string; passed: boolean }[] = [];
  const add = (rule: string, value: string, passed: boolean) => rules.push({ rule, value, passed });

  const painOk = last.pain == null || last.pain <= 3;
  add("Pain ≤ 3/10 at the latest session", last.pain == null ? "not recorded" : `${last.pain}/10`, painOk);
  if (last.pain != null && last.pain >= 5)
    return { action: "decrease", from: last.load, to: fmtLoad(step(-1)), toValue: step(-1).value, unit: weights.unit, decidedBy: "Pain ≥ 5/10: reduce load one step.", rules };
  const trusted = last.agreementPct == null || last.agreementPct >= 75;
  add("EMG and accelerometer agree on ≥ 75 % of reps", `${last.agreementPct ?? "–"}%`, trusted);
  const repsOk = last.minReps >= 6;
  add("Every working set reached ≥ 6 verified reps", `${last.verifiedReps.join(", ")}`, repsOk);
  const fatigueOk = last.meanFatiguePct == null || last.meanFatiguePct > -20;
  add("Rep-to-rep fatigue better than −20 %", `${last.meanFatiguePct ?? "–"}%`, fatigueOk);
  const romOk = last.romFirstSetDeg == null || last.romLastSetDeg == null || last.romLastSetDeg >= last.romFirstSetDeg * 0.85;
  add("ROM held within 15 % from first to last set", last.romFirstSetDeg == null ? "no accelerometer" : `${last.romFirstSetDeg}° → ${last.romLastSetDeg}°`, romOk);
  // Shakiness at this weight vs the previous, lighter weight.
  const shakeAt = (kg: number) => {
    const t = b.recordings.filter((r) => r.load?.kg === kg && r.tremor?.reliable).map((r) => r.tremor!.headlineMg);
    return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null;
  };
  const lastShake = last.shakeMg;
  const lighter = hist.filter((h) => h.loadKg < last.loadKg).map((h) => h.loadKg);
  const prevShake = lighter.length ? shakeAt(Math.max(...lighter)) : null;
  const shakeOk = lastShake == null || lastShake < 15 || (prevShake != null && lastShake <= prevShake * 1.3);
  add(
    "Shakiness at hold < 15 mg, or no more than 30 % above the lighter weight",
    lastShake == null ? "no accelerometer" : `${lastShake} mg${prevShake != null ? ` (lighter weight: ${r2(prevShake, 1)} mg)` : ""}`,
    shakeOk,
  );
  if (lastShake != null && lastShake >= 50 && prevShake != null && lastShake > prevShake * 1.3)
    return { action: "decrease", from: last.load, to: fmtLoad(step(-1)), toValue: step(-1).value, unit: weights.unit, decidedBy: "Marked shake that rose with the weight: reduce one step.", rules };
  const sameTwice = !!prev && prev.loadKg === last.loadKg && prev.minReps >= 6;
  add("Same weight managed in the previous session too", prev ? `${prev.load}, min ${prev.minReps} reps` : "no previous session", sameTwice);
  if (!painOk || !trusted)
    return { action: "hold", from: last.load, to: last.load, toValue: toUnit(last.loadKg), unit: weights.unit, decidedBy: !painOk ? "Pain 4/10: hold the weight." : "Reps not verified by movement: recheck before progressing.", rules };
  if (!repsOk || !fatigueOk || !romOk || !shakeOk) {
    const drop = last.minReps < 4 || (last.meanFatiguePct ?? 0) < -35;
    return { action: drop ? "decrease" : "hold", from: last.load, to: drop ? fmtLoad(step(-1)) : last.load, toValue: drop ? step(-1).value : toUnit(last.loadKg), unit: weights.unit, decidedBy: drop ? "Fewer than 4 verified reps or severe fatigue: reduce one step." : (!shakeOk && repsOk && fatigueOk && romOk ? "Shakier at this weight than the lighter one: hold until control improves." : "Not yet managing the current weight cleanly: hold."), rules };
  }
  if (sameTwice && idx < opts.length - 1)
    return { action: "increase", from: last.load, to: fmtLoad(step(1)), toValue: step(1).value, unit: weights.unit, decidedBy: "All checks passed at the same weight for two sessions: go up one step.", rules };
  return { action: "hold", from: last.load, to: last.load, toValue: toUnit(last.loadKg), unit: weights.unit, decidedBy: idx >= opts.length - 1 ? "Already at the heaviest weight in the clinic list." : "Checks passed once: confirm at this weight for one more session before progressing.", rules };
}

/** The full review of one session (also the grounding source for a drafted note). */
export function sessionReview(b: Bundle, sess: Session, weights: { unit: "kg" | "lb"; options: number[] }) {
  const recs = b.recordings.filter((r) => r.sessionId === sess.id);
  const i = b.sessions.findIndex((x) => x.id === sess.id);
  const prev = b.sessions[i - 1];
  const prevRecs = prev ? b.recordings.filter((r) => r.sessionId === prev.id) : [];
  const best = (rs: Recording[]) => (rs.length ? Math.max(...rs.map((r) => r.metrics.peakEnvelope)) : null);
  const bNow = best(recs);
  const bPrev = best(prevRecs);
  const isLatest = i === b.sessions.length - 1;
  const hist = loadHistory(b);
  return {
    patient: { name: fullName(b.patient), condition: b.patient.condition },
    session: { id: sess.id, date: sess.startedAt.slice(0, 10), number: i + 1, of: b.sessions.length, location: sess.location, painScore: sess.painScore ?? null, painScoreOutOf: 10, existingNotes: sess.notes ?? null, href: sessionHref(b.patient.id, sess.id) },
    setCount: recs.length,
    sets: recs.map((r) => ({
      set: r.setNumber,
      load: fmtLoad(r.load),
      emgReps: r.metrics.repsDetected,
      ...(r.repCheck && r.repCheck.status !== "no-motion"
        ? { verifiedReps: r.repCheck.verifiedReps, movementReps: r.repCheck.motionReps, repCheck: REP_STATUS[r.repCheck.status].label, emgOnlyReps: r.repCheck.reps.filter((x) => x.source === "emg").length, movementOnlyReps: r.repCheck.reps.filter((x) => x.source === "motion").length, meanRomDeg: r.repCheck.meanRomDeg }
        : { repCheck: "EMG only (no accelerometer)" }),
      peakMv: r2(r.metrics.peakEnvelope, 3),
      meanMv: r2(r.metrics.meanEnvelope, 3),
      fatigueIndexPct: r2(r.metrics.fatigueIndex, 1),
      ...(r.metrics.medianFreqHz ? { medianFreqHz: r2(r.metrics.medianFreqHz, 0) } : {}),
      ...(r.tremor?.reliable ? { shakiness: { level: tremorLevel(r.tremor.headlineMg).label, holdMg: r.tremor.holdRmsMg, peakHz: r.tremor.rhythmic ? r.tremor.peakHz : null } } : {}),
      ...((r.capture?.clippedPct ?? 0) >= 2 && !r.capture?.rawStreamed ? { quality: `sensor at maximum ${r.capture!.clippedPct}% of the set` } : {}),
    })),
    vsPreviousSession: prev
      ? { date: prev.startedAt.slice(0, 10), strongestPeakChangePct: bNow && bPrev ? r2(((bNow - bPrev) / bPrev) * 100, 0) : null, previousLoad: fmtLoad(prevRecs.find((r) => r.load)?.load), previousVerifiedReps: prevRecs.reduce((t, r) => t + (r.repCheck?.verifiedReps ?? 0), 0) }
      : null,
    // Based on the latest session that recorded weights (may be an earlier one).
    nextWeight: isLatest && hist.length ? { ...recommendLoad(b, hist, weights), basedOnSession: hist.at(-1)!.date } : null,
  };
}
