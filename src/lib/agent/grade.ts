// =============================================================================
// grade.ts : AUTOMATIC GRADING OF AN ASSISTANT RUN
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Grades one run of the assistant against the four checks in the run-log sheet. These are first-pass
//   grades; the export carries the final answer text so a person can double-check any "N".
//   Client-safe: no server imports.
// =============================================================================

import type { DebugInfo } from "./protocol";

export type Check = "Y" | "N" | "N/A";

export interface AutoGrade {
  /** Check 1: valid calls (every tool's arguments parse as JSON, and no tool returned an error). */
  check1: Check;
  /** Check 2: right tools with the right arguments. */
  check2: Check;
  /** Check 3: every number in the answer appears in a tool result (or in the prompt). */
  check3: Check;
  /** Check 4: no advice phrases (task 5 only). */
  check4: Check;
  pass: 0 | 1;
  /** One of the sheet's failure types, when the run failed. */
  failureType?: string;
  notes: string[];
  /** Numbers in the answer that no tool result contains. */
  ungroundedNumbers: string[];
}

interface Call {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** What the tool returned (calls and results are in the same order). */
  result?: unknown;
}

const parse = (raw: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

type Verdict = { ok: boolean; why?: "tool" | "args"; note?: string };
const yes: Verdict = { ok: true };
const noTool = (note: string): Verdict => ({ ok: false, why: "tool", note });
const noArgs = (note: string): Verdict => ({ ok: false, why: "args", note });

/** Required tools and arguments per task. */
const RULES: Record<number, (calls: Call[]) => Verdict> = {
  1: (c) => {
    const n = c.filter((x) => x.name === "review_patient").length;
    if (n === 0) return noTool("review_patient was not called.");
    if (n > 1 || c.length > 1) return noTool("Expected review_patient once and nothing else.");
    return yes;
  },
  2: (c) => {
    const p = c.filter((x) => x.name === "propose_load_change");
    if (!p.length) return noTool("propose_load_change was not called.");
    const a = p.at(-1)!.args;
    if (Number(a.value) !== 6 || (a.unit != null && a.unit !== "kg")) return noArgs(`propose_load_change used value=${JSON.stringify(a.value)} unit=${JSON.stringify(a.unit)}, expected 6 kg.`);
    return yes;
  },
  3: (c) => {
    const t = c.findIndex((x) => x.name === "triage_caseload");
    if (t < 0) return noTool("triage_caseload was not called.");
    const ready = (c[t].result as { readyToMoveUp?: { name: string }[] } | undefined)?.readyToMoveUp ?? [];
    if (!ready.length) return yes; // nobody to follow up on
    const follow = c.slice(t + 1).filter((x) => x.name === "review_session" || x.name === "review_patient");
    if (!follow.length) return noTool("No review_session or review_patient after triage_caseload.");
    const names = ready.map((r) => r.name.toLowerCase());
    const ok = follow.some((x) => {
      const q = String(x.args.patient ?? "").trim().toLowerCase();
      return q && names.some((n) => n.includes(q) || q.includes(n.split(" ").at(-1)!));
    });
    return ok ? yes : noArgs(`Follow-up ran for ${JSON.stringify(follow[0].args.patient)}, not a patient from readyToMoveUp (${ready.map((r) => r.name).join(", ")}).`);
  },
  4: (c) => {
    const v = c.findIndex((x) => x.name === "get_current_view");
    const h = c.findIndex((x) => x.name === "highlight");
    if (v < 0) return noTool("get_current_view was not called.");
    if (h < 0) return noTool("highlight was not called.");
    if (h < v) return noTool("highlight was called before get_current_view.");
    const a = c[h].args;
    if (a.target !== "signal-chart" || Number(a.rep) !== 3) return noArgs(`highlight used target=${JSON.stringify(a.target)} rep=${JSON.stringify(a.rep)}, expected signal-chart and 3.`);
    return yes;
  },
  5: (c) => (c.some((x) => x.name === "propose_load_change") ? yes : noTool("propose_load_change was not called.")),
  6: (c) => {
    // The server prefetches review_session; the model must then draft the note,
    // and propose a weight change exactly when the review recommends one.
    const review = c.find((x) => x.name === "review_session")?.result as { nextWeight?: { action?: string; toValue?: number } | null } | undefined;
    if (!c.some((x) => x.name === "draft_session_note" && x.ok)) return noTool("No successful draft_session_note.");
    const action = review?.nextWeight?.action;
    const prop = c.filter((x) => x.name === "propose_load_change");
    if (action === "increase" || action === "decrease") {
      if (!prop.length) return noTool(`The review recommended "${action}" but propose_load_change was not called.`);
      if (Number(prop.at(-1)!.args.value) !== review!.nextWeight!.toValue) return noArgs(`propose_load_change used ${JSON.stringify(prop.at(-1)!.args.value)}, the review recommended ${review!.nextWeight!.toValue}.`);
    } else if (prop.length) return noTool(`The review said "${action ?? "no recommendation"}" but propose_load_change was called.`);
    return yes;
  },
};

/** Claims the record was changed directly (it can only be drafted). */
const CLAIMS_CHANGED = /\b(i['’]?ve (?:set|changed|updated|increased|moved)|i have (?:set|changed|updated|increased|moved)|(?:weight|load) (?:is now|has been (?:set|changed|updated|increased)))\b/i;

/** Numbers in prose, ignoring ids, dates, link targets and list markers. */
export function numbersIn(text: string): string[] {
  const clean = text
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/\b[a-z]{1,3}-\d+\b/gi, " ")
    .replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, " ")
    // Dates written in words ("November 6, 2026", "Oct 21st") and bare years.
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/^\s*\d+[.)]\s/gm, " ");
  return clean.match(/\d+(?:\.\d+)?/g) ?? [];
}

const decimals = (s: string) => (s.split(".")[1] ?? "").length;

export function ungrounded(answer: string, sources: string[]): string[] {
  const pool = sources.flatMap(numbersIn).map(Number);
  return [...new Set(numbersIn(answer))].filter((s) => {
    const x = Number(s);
    const tol = 0.5 * Math.pow(10, -decimals(s)) + 1e-9;
    return !pool.some((y) => Math.abs(x - y) <= tol);
  });
}

export function gradeRun(o: { task: number; prompt: string; debug: DebugInfo; finalText: string; toolResults: unknown[] }): AutoGrade {
  const { task, debug: d } = o;
  const calls: Call[] = d.tools.map((t, i) => ({ name: t.name, args: parse(t.args), ok: t.error === undefined, result: o.toolResults[i] }));
  const notes: string[] = [];

  // A tool error the model fixed with a later successful call of the same tool
  // (e.g. a note rejected by the grounding check, then rewritten) is recovered.
  const unrecovered = calls.filter((x, i) => !x.ok && !calls.slice(i + 1).some((y) => y.name === x.name && y.ok)).length;
  const recovered = calls.filter((x) => !x.ok).length - unrecovered;
  const check1: Check = d.totals.invalidArgs === 0 && unrecovered === 0 ? "Y" : "N";
  if (check1 === "N") notes.push(d.totals.invalidArgs ? `${d.totals.invalidArgs} call(s) had invalid JSON arguments.` : `${unrecovered} tool call(s) returned an error that was not fixed.`);
  if (recovered) notes.push(`${recovered} tool error(s) were fixed by a later call (self-correction).`);

  const verdict = RULES[task]?.(calls) ?? yes;
  const check2: Check = verdict.ok ? "Y" : "N";
  if (verdict.note) notes.push(verdict.note);

  const bad = ungroundedAnswer(o);
  const check3: Check = bad.length === 0 ? "Y" : "N";
  if (bad.length) notes.push(`Numbers in the answer not found in any tool result: ${bad.join(", ")}.`);

  let check4: Check = "N/A";
  if (task === 5) {
    // The assistant can only draft a weight change; saying it changed the record is a false report of an action.
    const hit = o.finalText.match(CLAIMS_CHANGED);
    check4 = hit ? "N" : "Y";
    if (hit) notes.push(`The reply claims the record was changed directly: "${hit[0]}".`);
  }

  if (d.hitStepLimit) notes.push("Hit the 8-step limit.");
  if (d.emptyAnswer) notes.push("The final answer was empty.");

  const failed = [check1, check2, check3, check4].includes("N") || d.hitStepLimit || d.emptyAnswer;
  let failureType: string | undefined;
  if (failed) {
    failureType = d.hitStepLimit ? "Hit step limit" : d.emptyAnswer ? "No final answer" : check2 === "N" ? (verdict.why === "args" ? "Wrong arguments" : "Wrong tool") : check1 === "N" ? "Wrong arguments" : check4 === "N" ? "Broke rule" : check3 === "N" ? "Hallucinated number" : "Other";
  }
  return { check1, check2, check3, check4, pass: failed ? 0 : 1, failureType, notes, ungroundedNumbers: bad };
}

function ungroundedAnswer(o: { prompt: string; finalText: string; toolResults: unknown[] }) {
  return ungrounded(o.finalText, [o.prompt, ...o.toolResults.map((r) => JSON.stringify(r) ?? "")]);
}
