// =============================================================================
// runlog.ts : THE LOG OF TEST RUNS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   A browser-side log of the assistant's evaluation runs, and the JSON export of it.
//   Client-safe: no server imports.
// =============================================================================

import { gradeRun, type AutoGrade } from "./grade";
import { EVAL_TASKS } from "./eval-tasks";
import type { AgentRole, DebugInfo } from "./protocol";

export interface EvalRun {
  turnId: string;
  loggedAt: string;
  task: number;
  taskName: string;
  role: AgentRole;
  prompt: string;
  /** "off" or "on" (or "low"/"medium"/"high", or "default" if no level was sent). */
  condition: string;
  /** Count of earlier runs of this task and condition, plus one. */
  rep: number;
  finalAnswer: string;
  /** The same values, in the order and units of the run-log sheet's columns. */
  sheet: {
    dateTime: string;
    promptTokens: number | null;
    reasoningTokens: number;
    outputTokens: number;
    steps: number;
    ttftSec: number | null;
    totalSec: number;
    toolCalls: number;
    toolErrors: number;
    hitStepLimit: "Y" | "N";
    check1: string;
    check2: string;
    check3: string;
    check4: string;
    pass: 0 | 1;
    thinkingCheck: "OK" | "CHECK" | "n/a";
    failureType: string | null;
    notes: string;
  };
  auto: AutoGrade;
  debug: DebugInfo;
}

const KEY = "myocare-agent:runs";

export function loadRuns(): EvalRun[] {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as EvalRun[]) : [];
  } catch {
    return [];
  }
}

export function saveRuns(runs: EvalRun[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(runs));
  } catch {
    /* storage full or blocked: the log lasts until reload */
  }
}

const p2 = (x: number) => String(x).padStart(2, "0");
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export function thinkingCheck(d: DebugInfo): "OK" | "CHECK" | "n/a" {
  if (!d.thinkingSent) return "n/a";
  const reasoned = d.totals.reasoningTokens > 0;
  return (d.thinkingSent === "off") === reasoned ? "CHECK" : "OK";
}

export function buildRun(o: { turnId: string; task: number; prompt: string; role: AgentRole; finalText: string; toolResults: unknown[]; debug: DebugInfo }, existing: EvalRun[]): EvalRun {
  const t = EVAL_TASKS.find((x) => x.id === o.task);
  const condition = o.debug.thinkingSent ?? "default";
  const rep = existing.filter((r) => r.task === o.task && r.condition === condition).length + 1;
  const auto = gradeRun({ task: o.task, prompt: o.prompt, debug: o.debug, finalText: o.finalText, toolResults: o.toolResults });
  const tot = o.debug.totals;
  return {
    turnId: o.turnId,
    loggedAt: new Date().toISOString(),
    task: o.task,
    taskName: t?.name ?? `Task ${o.task}`,
    role: o.role,
    prompt: o.prompt,
    condition,
    rep,
    finalAnswer: o.finalText,
    sheet: {
      dateTime: stamp(o.debug.startedAt),
      promptTokens: tot.promptTokens ?? null,
      reasoningTokens: tot.reasoningTokens,
      outputTokens: tot.outputTokens,
      steps: o.debug.steps.length,
      ttftSec: tot.ttftMs === undefined ? null : Math.round(tot.ttftMs / 100) / 10,
      totalSec: Math.round(tot.wallMs / 100) / 10,
      toolCalls: tot.toolCalls,
      toolErrors: tot.toolErrors,
      hitStepLimit: o.debug.hitStepLimit ? "Y" : "N",
      check1: auto.check1,
      check2: auto.check2,
      check3: auto.check3,
      check4: auto.check4,
      pass: auto.pass,
      thinkingCheck: thinkingCheck(o.debug),
      failureType: auto.failureType ?? null,
      notes: auto.notes.join(" "),
    },
    auto,
    debug: o.debug,
  };
}

/** Downloads every logged run as one JSON file. */
export function downloadRuns(runs: EvalRun[]) {
  const d = new Date();
  const name = `myocare-runs-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
  const body = JSON.stringify({ version: 1, exportedAt: d.toISOString(), runs }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
