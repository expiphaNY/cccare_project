// =============================================================================
// DebugPanel.tsx : DEBUG TOOLS FOR THE ASSISTANT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Shown only when Debug is on: a picker for the six evaluation tasks, a run log and an export, used to grade the assistant automatically.
// =============================================================================

"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { EVAL_TASKS } from "@/lib/agent/eval-tasks";
import type { AgentRole, DebugInfo } from "@/lib/agent/protocol";
import type { EvalRun } from "@/lib/agent/runlog";
import { cx } from "../ui";

const n = (v: number | undefined, estimated = false) => (v === undefined ? "n/a" : `${estimated ? "~" : ""}${v.toLocaleString("en-US")}`);
const secs = (ms: number | undefined) => (ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

/** "OK" when the thinking setting did what it said; "CHECK" when it didn't. Same rule as the Thinking check column in the run log sheet. */
function thinkingCheck(d: DebugInfo): { label: "OK" | "CHECK" | "n/a"; note: string } {
  if (!d.thinkingSent) return { label: "n/a", note: "No level was sent, so the model default applied." };
  if (d.thinkingSent === "off") return d.totals.reasoningTokens > 0 ? { label: "CHECK", note: "Thinking was Off but the model still reasoned." } : { label: "OK", note: "Thinking was Off and no reasoning was produced." };
  return d.totals.reasoningTokens === 0 ? { label: "CHECK", note: "Thinking was on but the model produced no reasoning." } : { label: "OK", note: "Thinking was on and reasoning was produced." };
}

function stamp(iso: string) {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DebugPanel({ data: d }: { data: DebugInfo }) {
  const t = d.totals;
  const check = thinkingCheck(d);
  const tilde = !t.usageReported;
  const notes = [
    !t.usageReported && "LM Studio sent no token counts for this run, so tokens are estimated from text length (about 4 characters per token). Prompt tokens are unavailable.",
    t.usageReported && t.reasoningEstimated && "LM Studio did not report reasoning tokens separately, so reasoning is estimated from text length and output is the remainder.",
  ].filter(Boolean) as string[];

  // Two blocks, because the run log has a formula column (Total tokens) between them that a paste must not overwrite.
  const tokensRow = [stamp(d.startedAt), t.promptTokens ?? "", t.reasoningTokens, t.outputTokens].join("\t");
  const timingRow = [d.steps.length, t.ttftMs === undefined ? "" : (t.ttftMs / 1000).toFixed(1), (t.wallMs / 1000).toFixed(1), t.toolCalls, t.toolErrors, d.hitStepLimit ? "Y" : "N"].join("\t");

  return (
    <section aria-label="Debug data for this response" className="rounded-2xl border border-dashed border-brand/40 bg-brand-tint/40 p-3 text-[12px] text-ink-2">
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">Debug</p>
        <div className="flex flex-wrap justify-end gap-1.5">
          <CopyBtn label="Copy tokens" title="Date, prompt, reasoning, output. Paste into column E of the run log." text={tokensRow} />
          <CopyBtn label="Copy timing" title="Steps, time to first token, total time, tool calls, tool errors, step limit. Paste into column J of the run log." text={timingRow} />
          <CopyBtn label="Copy JSON" title="Everything on this panel." text={JSON.stringify(d, null, 2)} />
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <Fact label="Model" value={d.model} mono />
        <Fact label="Thinking sent" value={d.thinkingSent ?? "model default"} />
        <Fact label="Prompt tokens (all steps)" value={n(t.promptTokens)} />
        <Fact label="Reasoning tokens" value={n(t.reasoningTokens, tilde || t.reasoningEstimated)} />
        <Fact label="Output tokens" value={n(t.outputTokens, tilde || t.reasoningEstimated)} />
        <Fact label="Total tokens" value={n(t.totalTokens)} />
        <Fact label="Time to first token" value={secs(t.ttftMs)} />
        <Fact label="Total time" value={secs(t.wallMs)} />
        <Fact label="Speed" value={t.tokensPerSec === undefined ? "n/a" : `${t.tokensPerSec} tokens/s`} />
        <Fact label="Model steps" value={String(d.steps.length)} />
        <Fact label="Tool calls" value={`${t.toolCalls}${t.toolErrors ? ` (${t.toolErrors} error${t.toolErrors === 1 ? "" : "s"})` : ""}`} />
        <Fact label="Temperature" value={String(d.temperature)} />
      </dl>

      <ul className="mt-2 space-y-1">
        <Flag ok={check.label !== "CHECK"} text={`Thinking check: ${check.label}. ${check.note}`} />
        <Flag ok={!d.hitStepLimit} text={d.hitStepLimit ? "Hit the 8-step limit without a final answer." : "Finished within the step limit."} />
        <Flag ok={!d.emptyAnswer} text={d.emptyAnswer ? "The final answer was empty." : "The final answer has text."} />
        <Flag ok={t.invalidArgs === 0} text={t.invalidArgs ? `${t.invalidArgs} tool call${t.invalidArgs === 1 ? "" : "s"} had arguments that were not valid JSON.` : "All tool arguments were valid JSON."} />
      </ul>

      <Table
        title="Model steps"
        head={["Step", "Prompt", "Reason", "Output", "First token", "Time", "Tools"]}
        rows={d.steps.map((s) => [String(s.step), n(s.promptTokens), n(s.reasoningTokens, s.reasoningEstimated || s.completionTokens === undefined), n(s.outputTokens, s.completionTokens === undefined || s.reasoningEstimated), secs(s.ttftMs), secs(s.durationMs), String(s.toolCalls)])}
      />
      {d.tools.length > 0 && (
        <Table
          title="Tool calls"
          head={["Step", "Tool", "Args valid", "Result", "Time"]}
          rows={d.tools.map((c) => [String(c.step), c.name, c.argsValid ? "yes" : "NO", c.error ? `error: ${c.error}` : "ok", `${c.ms} ms`])}
          detail={d.tools.map((c) => c.args)}
        />
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11.5px] font-medium text-ink-2">Request fields LM Studio accepted</summary>
        <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink-3">
          {d.steps.map((s) => (
            <li key={s.step}>
              step {s.step}: {s.sent}
              {s.finishReason ? ` · finished: ${s.finishReason}` : ""}
            </li>
          ))}
        </ul>
      </details>
      {notes.map((x) => (
        <p key={x} className="mt-2 text-[11px] leading-snug text-ink-3">
          {x}
        </p>
      ))}
    </section>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className={cx("truncate font-medium text-ink", mono ? "font-mono text-[11.5px]" : "text-[12.5px]")} title={value}>
        {value}
      </dd>
    </div>
  );
}

function Flag({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={cx("flex gap-1.5 leading-snug", ok ? "text-ink-2" : "font-medium text-bad")}>
      <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", ok ? "bg-good" : "bg-bad")} aria-hidden />
      {text}
    </li>
  );
}

function Table({ title, head, rows, detail }: { title: string; head: string[]; rows: string[][]; detail?: string[] }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-semibold text-ink">{title}</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[320px] border-collapse text-left text-[11.5px] tabular-nums">
          <thead>
            <tr className="bg-canvas text-ink-3">
              {head.map((h) => (
                <th key={h} scope="col" className="px-2 py-1 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line align-top">
                {r.map((c, j) => (
                  <td key={j} className={cx("px-2 py-1", c === "NO" || c.startsWith("error") ? "font-medium text-bad" : "text-ink-2", j === 1 && detail && "font-mono")}>
                    {c}
                    {j === 1 && detail?.[i] && <span className="mt-0.5 block max-w-[220px] break-words font-mono text-[10.5px] font-normal text-ink-3">{detail[i]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CopyBtn({ label, text, title }: { label: string; text: string; title: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
      className="pressable inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-white px-2 py-1 text-[11px] font-medium text-ink-2 hover:border-brand/40 hover:text-ink"
    >
      {done ? <Check className="size-3 text-good" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

/** Task picker and run log, shown above the message box while Debug is on. */
export function EvalBar({ role, task, onTask, runs, onExport, onUndo, onClear }: { role: AgentRole; task: number; onTask: (id: number) => void; runs: EvalRun[]; onExport: () => void; onUndo: () => void; onClear: () => void }) {
  const tasks = EVAL_TASKS.filter((t) => t.role === role);
  const picked = EVAL_TASKS.find((t) => t.id === task);
  const last = runs[runs.length - 1];
  const btn = "pressable inline-flex cursor-pointer items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink-2 hover:border-brand/40 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="mb-2 rounded-2xl border border-dashed border-brand/40 bg-brand-tint/40 p-2.5 text-[12px] text-ink-2">
      <div className="flex items-center gap-2">
        <label htmlFor="eval-task" className="shrink-0 font-medium text-ink">
          Test task
        </label>
        <select id="eval-task" value={task || ""} onChange={(e) => onTask(Number(e.target.value))} className="min-w-0 flex-1 cursor-pointer rounded-lg border border-line bg-white px-2 py-1 text-[12px] text-ink">
          <option value="">None (runs are not logged)</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} · {t.name}
            </option>
          ))}
        </select>
      </div>
      {picked && (
        <p className="mt-1.5 leading-snug text-ink-3">
          Each send starts a fresh conversation and is logged and graded automatically. The prompt is filled in for you.
          {picked.hint ? ` ${picked.hint}` : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="mr-auto tabular-nums">
          <strong className="font-semibold text-ink">{runs.length}</strong> run{runs.length === 1 ? "" : "s"} logged
          {last ? ` · last: task ${last.task}, ${last.condition}, rep ${last.rep}, ${last.auto.pass ? "pass" : "fail"}` : ""}
        </span>
        <button type="button" onClick={onExport} disabled={!runs.length} className={btn}>
          <Download className="size-3" aria-hidden /> Export JSON
        </button>
        <button type="button" onClick={onUndo} disabled={!runs.length} className={btn}>
          Undo last
        </button>
        <button type="button" onClick={onClear} disabled={!runs.length} className={btn}>
          Clear all
        </button>
      </div>
    </div>
  );
}
