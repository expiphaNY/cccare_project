// =============================================================================
// AgentDock.tsx : THE ASSISTANT'S CHAT WINDOW (MyoMinion)
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The floating button and chat panel on every clinician page. It sends the question to /api/agent, shows the streamed steps and answer, offers starter prompts about the page you are on, shows draft cards, and can point at parts of the page.
// =============================================================================

"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowUp, Bug, Check, ChevronDown, MessageSquareText, NotebookPen, RotateCcw, Square, X } from "lucide-react";
import type { AgentEvent, AgentMode, AgentRole, ClientAction, DebugInfo, PageTarget, ThinkingInfo, ThinkingLevel, ToolUi, WireMessage } from "@/lib/agent/protocol";
import { ASK_EVENT, HIGHLIGHT_EVENT } from "@/lib/agent/target";
import { DEMO } from "@/lib/demo";
import { Segmented } from "../Segmented";
import { cx } from "../ui";
import { EVAL_TASKS } from "@/lib/agent/eval-tasks";
import { buildRun, downloadRuns, loadRuns, saveRuns, type EvalRun } from "@/lib/agent/runlog";
import { DebugPanel, EvalBar } from "./DebugPanel";
import { Markdown } from "./Markdown";
import { Spotlight } from "./Spotlight";

// ---- Conversation model -------------------------------------------------------

type Block =
  | { kind: "thinking"; text: string; start: number; end?: number; redacted?: boolean }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; label: string; args: Record<string, unknown>; status: "running" | "ok" | "error"; result?: unknown; ui?: ToolUi }
  | { kind: "error"; code: string; message: string };

type Turn = { id: string; role: "user"; text: string } | { id: string; role: "assistant"; blocks: Block[]; done: boolean; model?: string; thinkingSetting?: ThinkingLevel; debug?: DebugInfo };

type Status = { state: "checking" } | { state: "ok"; model: string; thinking: ThinkingInfo } | { state: "error"; message: string };

/** Starter prompts: caseload-wide, or about the patient / session on screen. */
function promptsFor(path: string): string[] {
  if (/^\/doctor\/patients\/[^/]+\/sessions\/[^/]+/.test(path))
    return ["Were the reps in this session real? Which ones did the sensors disagree on?", "How did this session go compared with the last one?"];
  if (/^\/doctor\/patients\/[^/]+/.test(path))
    return ["Brief me on this patient before today's visit", "Should this patient move up in weight?"];
  return ["Who needs my attention today?", "Who is ready to move up in weight?"];
}

const uid = () => Math.random().toString(36).slice(2, 10);

function collectTargets(): PageTarget[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-agent-target]")).map((el) => ({
    id: el.dataset.agentTarget!,
    label: el.dataset.agentLabel ?? el.dataset.agentTarget!,
  }));
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: conversation lives for this page only */
  }
}

/** Applies one streamed event to the assistant turn being built. */
function apply(turn: Extract<Turn, { role: "assistant" }>, e: AgentEvent, role: AgentRole): Extract<Turn, { role: "assistant" }> {
  const now = Date.now();
  const blocks = turn.blocks.map((b) => (b.kind === "thinking" && !b.end && e.type !== "thinking" ? { ...b, end: now } : b));
  const last = blocks[blocks.length - 1];
  switch (e.type) {
    case "model":
      return { ...turn, model: e.model, blocks };
    case "thinking":
      // Redacted reasoning is discarded, not just blurred, so it never sits in the DOM or storage.
      if (last?.kind === "thinking" && !last.end) blocks[blocks.length - 1] = last.redacted ? last : { ...last, text: last.text + e.text };
      else {
        const redacted = blocks.some((b) => b.kind === "thinking" && b.redacted);
        blocks.push({ kind: "thinking", text: redacted ? "" : e.text, start: now, redacted });
      }
      return { ...turn, blocks };
    case "text":
      if (last?.kind === "text") blocks[blocks.length - 1] = { ...last, text: last.text + e.text };
      else if (e.text.trim()) blocks.push({ kind: "text", text: e.text.replace(/^\s+/, "") });
      return { ...turn, blocks };
    case "tool_start": {
      void role;
      const next = blocks;
      next.push({ kind: "tool", id: e.id, name: e.name, label: e.label, args: e.args, status: "running" });
      return { ...turn, blocks: next };
    }
    case "tool_end":
      return { ...turn, blocks: blocks.map((b) => (b.kind === "tool" && b.id === e.id ? { ...b, status: e.ok ? "ok" : "error", result: e.result, ui: e.ui } : b)) };
    case "debug":
      return { ...turn, blocks, debug: e.data };
    case "error":
      blocks.push({ kind: "error", code: e.code, message: e.message });
      return { ...turn, blocks };
    case "done":
      return { ...turn, blocks, done: true };
    default:
      return { ...turn, blocks };
  }
}

// ---- Dock ---------------------------------------------------------------------

export function AgentDock({ role }: { role: AgentRole }) {
  const params = useParams<{ pid?: string }>();
  const pathname = usePathname();
  void params;
  const patientId = undefined;
  const key = `myocare-agent:${role}:all`;

  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<WireMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "checking" });
  // Thinking level chosen per model (remembered in this browser).
  const [choices, setChoices] = useState<Record<string, ThinkingLevel>>({});
  // Debug panel under each finished response (remembered in this browser).
  const [debugOn, setDebugOn] = useState(false);
  // Test task picked in the debug bar (0 = none) and the runs logged so far in this browser.
  const [evalTask, setEvalTask] = useState(0);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  // Restore the conversation for this tab (survives navigation and reloads).
  // `hydratedKey` holds back saving until the restored state has rendered, so
  // the initial empty state can never overwrite what's stored.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const restoring = useRef<string | null>(null);
  useEffect(() => {
    if (restoring.current === key) return;
    restoring.current = key;
    const s = load<{ turns: Turn[]; history: WireMessage[]; open?: boolean }>(key, { turns: [], history: [] });
    // Syncing from sessionStorage, an external store, once per key (guarded above).
    setTurns(s.turns.map((t) => (t.role === "assistant" && !t.done ? { ...t, done: true } : t)));
    setHistory(s.history);
    setOpen(!!s.open);
    setChoices(loadLocal<Record<string, ThinkingLevel>>(THINKING_KEY, {}));
    setDebugOn(loadLocal<boolean>(DEBUG_KEY, false));
    setRuns(loadRuns());
    setHydratedKey(key);
  }, [key]);
  useEffect(() => {
    if (hydratedKey === key && !busy) save(key, { turns, history, open });
  }, [hydratedKey, key, turns, history, open, busy]);

  const checkStatus = useCallback(() => {
    setStatus({ state: "checking" });
    fetchStatus().then(setStatus);
  }, []);
  useEffect(() => {
    if (open && !DEMO) {
      fetchStatus().then(setStatus);
      const t = window.setTimeout(() => inputRef.current?.focus(), 250);
      return () => window.clearTimeout(t);
    }
  }, [open, checkStatus]);

  // Keep scrolled to the bottom while streaming, unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  // Persist the run log (after the restore above has loaded it, so the empty initial state can't overwrite it).
  useEffect(() => {
    if (hydratedKey === key) saveRuns(runs);
  }, [hydratedKey, key, runs]);

  const send = useCallback(
    async (text: string, askedMode?: AgentMode) => {
      const q = text.trim();
      if (!q || busy) return;
      const task = debugOn ? evalTask : 0;
      const mode = askedMode ?? EVAL_TASKS.find((x) => x.id === task)?.mode;
      const taskPrompt = EVAL_TASKS.find((x) => x.id === task)?.prompt ?? "";
      // Test runs always start a fresh conversation, so an earlier answer can't leak into this one.
      const prior = task ? [] : history;
      // Keep the task's prompt in the box so the next run is one keypress away.
      setInput(taskPrompt);
      stick.current = true;
      const userMsg: WireMessage = { role: "user", content: q };
      const aid = uid();
      const level = status.state === "ok" ? effectiveChoice(status.thinking, choices[status.model]) : undefined;
      // What the picker showed (the model's default when nothing was chosen), for the "ignored" notice.
      const shown = level ?? (status.state === "ok" ? status.thinking.default : undefined);
      const pair: Turn[] = [{ id: uid(), role: "user", text: q }, { id: aid, role: "assistant", blocks: [], done: false, thinkingSetting: shown }];
      setTurns((t) => (task ? pair : [...t, ...pair]));
      setBusy(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      const update = (e: AgentEvent) => setTurns((ts) => ts.map((t) => (t.id === aid && t.role === "assistant" ? apply(t, e, role) : t)));
      let added: WireMessage[] = [];
      // What a logged run needs once the stream ends.
      let dbg: DebugInfo | undefined;
      let finalText = "";
      const toolResults: unknown[] = [];
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role, patientId, mode, messages: mode ? [userMsg] : [...prior, userMsg], thinking: level, view: { path: pathname, search: window.location.search, targets: collectTargets() } }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`The assistant returned ${res.status}.`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const e = JSON.parse(line) as AgentEvent;
            if (e.type === "history") added = e.messages;
            if (e.type === "debug") dbg = e.data;
            if (e.type === "step" || e.type === "tool_start") finalText = "";
            if (e.type === "text") finalText += e.text;
            if (e.type === "tool_end") toolResults.push(e.result);
            if (e.type === "model") setStatus((s) => (s.state === "ok" ? { ...s, model: e.model } : s));
            if (e.type === "error" && (e.code === "server_stopped" || e.code === "no_model")) setStatus({ state: "error", message: e.message });
            if (e.type === "tool_end" && e.client) highlight(e.client);
            update(e);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") update({ type: "error", code: "model_error", message: (err as Error).message });
      } finally {
        update({ type: "done" });
        setHistory((h) => (task ? [userMsg, ...added] : [...h, userMsg, ...added]));
        if (task && dbg) {
          const debug = dbg;
          const answer = finalText.trim();
          setRuns((prev) => [...prev, buildRun({ turnId: aid, task, prompt: q, role, finalText: answer, toolResults, debug }, prev)]);
        }
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, history, pathname, patientId, role, status, choices, debugOn, evalTask],
  );

  const reset = () => {
    abort.current?.abort();
    setTurns([]);
    setHistory([]);
    inputRef.current?.focus();
  };

  // Requests from buttons elsewhere on the page (e.g. the session wrap-up button).
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ prompt: string; mode?: AgentMode }>).detail;
      if (!d?.prompt) return;
      setOpen(true);
      void sendRef.current(d.prompt, d.mode);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);

  return (
    <>
      <Spotlight />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="agent-panel"
        className={cx(
          "agent-launcher no-print pressable fixed right-4 z-50 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-medium text-white shadow-[var(--shadow-pop)] hover:bg-[#1b2d47] sm:right-6",
          "bottom-6",
        )}
        data-open={open || undefined}
      >
        <MessageSquareText className="size-[18px]" aria-hidden />
        <span>MyoMinion</span>
      </button>

      <aside
        id="agent-panel"
        aria-label="Assistant"
        className="agent-panel no-print fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-white shadow-[var(--shadow-pop)] sm:inset-y-3 sm:right-3 sm:w-[440px] sm:rounded-[22px] sm:border"
        data-open={open || undefined}
        inert={!open}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="title text-[16px] font-semibold">Assistant</h2>
            <StatusLine status={status} onRetry={checkStatus} />
          </div>
          {!DEMO && (
            <button
              type="button"
              role="switch"
              aria-checked={debugOn}
              onClick={() => {
                setDebugOn(!debugOn);
                saveLocal(DEBUG_KEY, !debugOn);
              }}
              title="Show tokens, timing and tool calls under each response"
              className={cx(
                "pressable inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium",
                debugOn ? "border-brand/40 bg-brand-tint text-brand" : "border-line text-ink-2 hover:bg-canvas hover:text-ink",
              )}
            >
              <Bug className="size-3.5" aria-hidden />
              Debug
            </button>
          )}
          {turns.length > 0 && (
            <IconBtn label="New conversation" onClick={reset}>
              <RotateCcw className="size-4" aria-hidden />
            </IconBtn>
          )}
          <IconBtn label="Close assistant" onClick={() => setOpen(false)}>
            <X className="size-[18px]" aria-hidden />
          </IconBtn>
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        >
          {DEMO ? (
            <p className="rounded-2xl bg-canvas p-4 text-[13px] text-ink-2">The assistant needs the app server and a local LM Studio model, so it isn’t available in the read-only demo.</p>
          ) : turns.length === 0 ? (
            <Empty role={role} onPick={send} />
          ) : (
            <div className="space-y-4">
              {turns.map((t) => (t.role === "user" ? <UserBubble key={t.id} text={t.text} /> : <AssistantTurn key={t.id} turn={t} role={role} debug={debugOn} />))}
            </div>
          )}
        </div>

        {!DEMO && (
          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {debugOn && (
              <EvalBar
                role={role}
                task={evalTask}
                onTask={(id) => {
                  setEvalTask(id);
                  setInput(EVAL_TASKS.find((x) => x.id === id)?.prompt ?? "");
                  inputRef.current?.focus();
                }}
                runs={runs}
                onExport={() => downloadRuns(runs)}
                onUndo={() => {
                  const last = runs[runs.length - 1];
                  if (!last) return;
                  setRuns(runs.slice(0, -1));
                }}
                onClear={() => {
                  if (!window.confirm(`Delete all ${runs.length} logged runs from this browser? Export first if you need them.`)) return;
                  setRuns([]);
                }}
              />
            )}
            <div className="flex items-end gap-2 rounded-[20px] border border-line-strong bg-white p-1.5 pl-3.5 focus-within:border-ink-3">
              <label htmlFor="agent-input" className="sr-only">
                Message the assistant
              </label>
              <textarea
                id="agent-input"
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask about reps, weights or your patients…"
                className="max-h-[140px] min-h-9 flex-1 resize-none bg-transparent py-2 text-[14px] leading-snug outline-none placeholder:text-ink-3"
              />
              {busy ? (
                <button type="button" onClick={() => abort.current?.abort()} className="pressable flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-white" aria-label="Stop">
                  <Square className="size-3.5 fill-current" aria-hidden />
                </button>
              ) : (
                <button type="submit" disabled={!input.trim()} className="pressable flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand text-white disabled:cursor-not-allowed disabled:bg-line-strong" aria-label="Send">
                  <ArrowUp className="size-[18px]" aria-hidden />
                </button>
              )}
            </div>
            {status.state === "ok" && (
              <ThinkingPicker
                info={status.thinking}
                value={effectiveChoice(status.thinking, choices[status.model])}
                onChange={(lvl) => {
                  const next = { ...choices, [status.model]: lvl };
                  setChoices(next);
                  saveLocal(THINKING_KEY, next);
                }}
              />
            )}
            <p className="mt-2 px-1 text-[11px] leading-snug text-ink-3">
              Runs on a local model and can make mistakes. Drafts change nothing until you approve them.
            </p>
          </form>
        )}
      </aside>
    </>
  );
}

async function fetchStatus(): Promise<Status> {
  try {
    const r = await fetch("/api/agent", { cache: "no-store" });
    const j = (await r.json()) as { ok: boolean; model?: string; message?: string; thinking?: ThinkingInfo };
    return j.ok ? { state: "ok", model: j.model!, thinking: j.thinking ?? { source: "unconfirmed", options: ["off", "on"] } } : { state: "error", message: j.message ?? "Assistant unavailable." };
  } catch {
    return { state: "error", message: "Couldn’t reach the app server." };
  }
}

const THINKING_KEY = "myocare-agent:thinking";
const DEBUG_KEY = "myocare-agent:debug";

function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveLocal(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

/** The level to send: the user's pick if the model still offers it, else undefined (model default). */
function effectiveChoice(info: ThinkingInfo, picked?: ThinkingLevel): ThinkingLevel | undefined {
  return picked && info.options.includes(picked) ? picked : undefined;
}

const LEVEL_LABEL: Record<ThinkingLevel | "auto", string> = { auto: "Auto", off: "Off", on: "On", low: "Low", medium: "Medium", high: "High" };

function ThinkingPicker({ info, value, onChange }: { info: ThinkingInfo; value?: ThinkingLevel; onChange: (v: ThinkingLevel) => void }) {
  // One option can't be a choice (e.g. a model that always thinks).
  if (info.options.length < 2) return null;
  const unconfirmed = info.source === "unconfirmed";
  const shown: ThinkingLevel | "auto" = value ?? (unconfirmed ? "auto" : (info.default ?? info.options[0]));
  const options = [...(unconfirmed ? (["auto"] as const) : []), ...info.options].map((o) => ({ value: o, label: LEVEL_LABEL[o] }));
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
      <span className="text-[12px] font-medium text-ink-2">Thinking</span>
      <Segmented
        label="Thinking strength"
        size="sm"
        value={shown}
        options={options}
        onChange={(v) => v !== "auto" && onChange(v)}
      />
      {unconfirmed && (
        <span className="text-[11px] text-ink-3" title="LM Studio didn’t list thinking options for this model, so On/Off is a best guess and may be ignored.">
          unconfirmed for this model
        </span>
      )}
    </div>
  );
}

function highlight(a: ClientAction) {
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail: a }));
}

// ---- Pieces -------------------------------------------------------------------

function StatusLine({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (DEMO) return <p className="text-[12px] text-ink-3">Unavailable in demo</p>;
  if (status.state === "checking")
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <Spinner size="xs" /> Connecting to LM Studio…
      </p>
    );
  if (status.state === "ok")
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2" title={status.model}>
        <span className="size-1.5 shrink-0 rounded-full bg-good" aria-hidden />
        <span className="truncate font-mono text-[11.5px]">{status.model}</span>
      </p>
    );
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-warn">
      <span className="size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
      <span className="truncate">{status.message.split(".")[0]}</span>
      <button type="button" onClick={onRetry} className="shrink-0 cursor-pointer font-medium text-brand hover:underline">
        Retry
      </button>
    </p>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="pressable flex size-9 cursor-pointer items-center justify-center rounded-full text-ink-2 hover:bg-canvas hover:text-ink">
      {children}
    </button>
  );
}

function Spinner({ size = "sm" }: { size?: "xs" | "sm" }) {
  return <span className={cx("agent-spinner inline-block shrink-0 rounded-full border-2 border-brand/20 border-t-brand", size === "xs" ? "size-3" : "size-3.5")} aria-hidden />;
}

function Empty({ role, onPick }: { role: AgentRole; onPick: (q: string) => void }) {
  void role;
  const pathname = usePathname();
  return (
    <div className="fade-in">
      <p className="title text-[20px] font-semibold">MyoMinion</p>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
        I do the work that takes more than a couple of clicks: triage the caseload, brief you on a patient from all their sessions, review a
        session&rsquo;s reps and shakiness, and draft notes and weight changes for you to approve. On a session page, use Wrap up for a one-click note.
      </p>
      <div className="mt-5 flex flex-col items-start gap-2">
        {promptsFor(pathname).map((p) => (
          <button key={p} type="button" onClick={() => onPick(p)} className="pressable cursor-pointer rounded-full border border-line bg-white px-3.5 py-2 text-left text-[13px] font-medium text-ink hover:border-brand/40 hover:bg-brand-tint">
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-brand px-3.5 py-2 text-[14px] leading-snug text-white">{text}</p>
    </div>
  );
}

function AssistantTurn({ turn, role, debug }: { turn: Extract<Turn, { role: "assistant" }>; role: AgentRole; debug: boolean }) {
  const working = !turn.done;
  const lastKind = turn.blocks[turn.blocks.length - 1]?.kind;
  const waiting = working && (turn.blocks.length === 0 || (lastKind === "tool" && turn.blocks.every((b) => b.kind !== "tool" || b.status !== "running")));
  const ignored = turn.thinkingSetting === "off" && turn.blocks.some((b) => b.kind === "thinking");
  return (
    <div className="space-y-2">
      {ignored && (
        <p className="flex gap-1.5 px-1 text-[12px] leading-snug text-ink-3">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          Thinking was set to Off, but the model still reasoned. LM Studio may be ignoring the setting for this model.
        </p>
      )}
      {turn.blocks.map((b, i) => {
        if (b.kind === "thinking") return <ThinkingBlock key={i} block={b} live={working && i === turn.blocks.length - 1} />;
        if (b.kind === "tool") return <ToolBlock key={b.id} block={b} role={role} />;
        if (b.kind === "error") return <ErrorBlock key={i} message={b.message} />;
        return (
          <div key={i} className="px-1">
            <Markdown text={b.text} />
          </div>
        );
      })}
      {waiting && (
        <p className="flex items-center gap-2 px-1 text-[13px] text-ink-3">
          <Spinner /> {turn.blocks.length === 0 ? "Starting…" : "Working…"}
        </p>
      )}
      {debug && turn.done && turn.debug && <DebugPanel data={turn.debug} />}
    </div>
  );
}

/** Collapsible pill, the shared shell for thinking and tool steps. */
function Step({ header, icon, children, defaultOpen = false, live = false }: { header: ReactNode; icon: ReactNode; children?: ReactNode; defaultOpen?: boolean; live?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const expandable = !!children;
  return (
    <div className={cx("rounded-2xl border bg-white transition-colors", live ? "border-brand/25" : "border-line")}>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={cx("flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-ink-2", expandable && "cursor-pointer hover:text-ink")}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{header}</span>
        {expandable && <ChevronDown className={cx("size-4 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />}
      </button>
      {expandable && (
        <div className="agent-collapse" data-open={open || undefined}>
          <div className="overflow-hidden">
            <div className="border-t border-line px-3 py-2.5">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ block, live }: { block: Extract<Block, { kind: "thinking" }>; live: boolean }) {
  const [now, setNow] = useState(block.start);
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [live]);
  const secs = Math.max(1, Math.round(((block.end ?? now) - block.start) / 1000));
  return (
    <Step
      live={live}
      icon={live ? <Spinner /> : <span className="size-3.5 shrink-0 rounded-full border-2 border-line-strong" aria-hidden />}
      header={live ? `Thinking… ${secs}s` : `Thought for ${secs} second${secs === 1 ? "" : "s"}`}
    >
      <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{block.text.trim()}</p>
    </Step>
  );
}

const TOOL_VERB: Record<string, string> = {
  get_current_view: "Read the current page",
  highlight: "Highlighted on screen",
  review_patient: "Reviewed the patient's record",
  review_session: "Reviewed the session",
  triage_caseload: "Triaged the caseload",
  propose_load_change: "Drafted a weight change",
  draft_session_note: "Drafted a session note",
};

function summary(b: Extract<Block, { kind: "tool" }>): string {
  const r = b.result as Record<string, unknown> | unknown[] | undefined;
  if (b.status === "running") return `Running ${b.name.replace(/_/g, " ")}…`;
  if (b.status === "error") return `${TOOL_VERB[b.name] ?? b.name}: ${(r as { error?: string })?.error ?? "failed"}`;
  if (Array.isArray(r)) return `${TOOL_VERB[b.name] ?? b.name} · ${r.length} found`;
  if (r && typeof r === "object") {
    if (Array.isArray((r as { ranked?: unknown[] }).ranked)) {
      const top = (r as { ranked: { name: string }[] }).ranked[0];
      return top ? `Ranked patients · top: ${top.name}` : "Ranked patients · no data";
    }
    if (typeof (r as { matches?: number }).matches === "number") return `Filtered patients · ${(r as { matches: number }).matches} match`;
    if (typeof (r as { flagged?: number }).flagged === "number") return `Checked data quality · ${(r as { flagged: number }).flagged} flagged`;
  }
  return TOOL_VERB[b.name] ?? b.name;
}

function ToolBlock({ block, role }: { block: Extract<Block, { kind: "tool" }>; role: AgentRole }) {
  const call = (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2">
      {block.status === "running" ? <Spinner size="xs" /> : block.status === "ok" ? <Check className="size-3.5 shrink-0 text-good" strokeWidth={2.6} aria-hidden /> : <AlertCircle className="size-3.5 shrink-0 text-bad" aria-hidden />}
      <span className="font-medium text-ink">{block.status === "running" ? "calling" : "called"}</span>
      <code className="truncate font-mono text-[12px]">
        {block.name}({block.label})
      </code>
    </span>
  );

  void role;
  if ((block.name === "propose_load_change" || block.name === "draft_session_note") && block.status !== "error") {
    return (
      <div className="space-y-1.5">
        <DraftCard ui={block.ui} running={block.status === "running"} />
        <div className="px-1">{call}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Step
        icon={block.status === "running" ? <Spinner /> : block.status === "ok" ? <Check className="size-3.5 shrink-0 text-good" strokeWidth={2.6} aria-hidden /> : <AlertCircle className="size-3.5 shrink-0 text-bad" aria-hidden />}
        header={summary(block)}
        live={block.status === "running"}
      >
        <div className="space-y-2">
          <JsonView title="Arguments" value={block.args} />
          {block.result !== undefined && <JsonView title="Result" value={block.result} />}
        </div>
      </Step>
      <div className="px-1">{call}</div>
    </div>
  );
}

function JsonView({ title, value }: { title: string; value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "";
  return (
    <div>
      <p className="eyebrow mb-1">{title}</p>
      <pre className="max-h-56 overflow-auto rounded-xl bg-canvas p-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">{text.length > 8000 ? text.slice(0, 8000) + "\n…" : text}</pre>
    </div>
  );
}

export function DraftCard({ ui, running }: { ui?: ToolUi; running?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-brand-tint px-3.5 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-brand shadow-sm">
        {running ? <Spinner /> : <NotebookPen className="size-4" aria-hidden />}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink">{running ? "Saving draft…" : (ui?.title ?? "Draft saved")}</p>
        <p className="text-[12px] text-ink-2">
          Waiting for your approval
          {ui?.href && !running && (
            <>
              {" · "}
              <Link href={ui.href} className="font-medium text-brand hover:underline">
                Review draft
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-2xl border border-[#f3d6a8] bg-warn-soft px-3 py-2.5 text-[13px] text-warn" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
