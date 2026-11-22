// =============================================================================
// lmstudio.ts : TALKING TO THE LOCAL LM STUDIO MODEL
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   A small client for LM Studio's local server (same style as the OpenAI interface). It lists the loaded model, sends a conversation with tool descriptions, and turns the streamed reply into events. Everything stays on the clinic's computer.
// =============================================================================

import "server-only";

/**
 * Minimal client for a local LM Studio server (OpenAI-compatible API).
 * The model is whichever one is currently loaded in LM Studio.
 */

export const LMSTUDIO_URL = (process.env.LMSTUDIO_URL ?? "http://localhost:1234").replace(/\/$/, "");

import { THINKING_LEVELS, type ThinkingInfo, type ThinkingLevel } from "./protocol";

export type ModelStatus =
  | { ok: true; model: string; thinking: ThinkingInfo }
  | { ok: false; code: "server_stopped" | "no_model"; message: string };

export const STATUS_MESSAGES = {
  server_stopped: "LM Studio server stopped. Open LM Studio → Developer and start the server on localhost:1234.",
  no_model: "No model loaded. Load a model in LM Studio, then try again.",
} as const;

interface ModelEntry {
  id?: string;
  key?: string;
  type?: string;
  state?: string;
  loaded_instances?: unknown[];
  capabilities?: unknown;
}

const isLevel = (x: unknown): x is ThinkingLevel => THINKING_LEVELS.includes(x as ThinkingLevel);

/** Reads `capabilities.reasoning` ({ allowed_options, default }) from LM Studio's model list. */
function thinkingInfo(m: ModelEntry | undefined): ThinkingInfo {
  const caps = m?.capabilities;
  const r = caps && typeof caps === "object" && !Array.isArray(caps) ? (caps as { reasoning?: { allowed_options?: unknown[]; default?: unknown } }).reasoning : undefined;
  const options = Array.isArray(r?.allowed_options) ? r.allowed_options.filter(isLevel) : [];
  if (options.length) return { source: "reported", options, default: isLevel(r?.default) ? r.default : undefined };
  // LM Studio did not say (older version, or the model wasn't detected as a reasoning model).
  return { source: "unconfirmed", options: ["off", "on"] };
}

async function getJson(path: string): Promise<unknown | null> {
  const res = await fetch(`${LMSTUDIO_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LM Studio ${path} returned ${res.status}`);
  return res.json();
}

/**
 * Finds the loaded model. Tries LM Studio's native REST API first (which says
 * which models are actually loaded), then the OpenAI-compatible list.
 */
export async function getModelStatus(): Promise<ModelStatus> {
  try {
    for (const path of ["/api/v1/models", "/api/v0/models"]) {
      const j = (await getJson(path)) as { data?: ModelEntry[]; models?: ModelEntry[] } | null;
      if (!j) continue;
      const list = (j.models ?? j.data ?? []).filter((m) => m.type !== "embeddings" && m.type !== "embedding");
      const loaded = list.find((m) => m.state === "loaded" || (Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0));
      if (loaded) return { ok: true, model: (loaded.id ?? loaded.key)!, thinking: thinkingInfo(loaded) };
      return { ok: false, code: "no_model", message: STATUS_MESSAGES.no_model };
    }
    const j = (await getJson("/v1/models")) as { data?: ModelEntry[] } | null;
    const first = j?.data?.find((m) => !/embed/i.test(m.id ?? ""));
    if (first?.id) return { ok: true, model: first.id, thinking: thinkingInfo(first) };
    return { ok: false, code: "no_model", message: STATUS_MESSAGES.no_model };
  } catch {
    return { ok: false, code: "server_stopped", message: STATUS_MESSAGES.server_stopped };
  }
}

// ---- Chat completions -------------------------------------------------------

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type StreamEvent =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string };

/** Measurements for one completion, used by the chat's Debug panel. */
export interface StepStats {
  /** Request fields LM Studio accepted ("none" = a plain request). */
  sent: string;
  /** From the final `usage` chunk; undefined when LM Studio doesn't send one. */
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  thinkingChars: number;
  outputChars: number;
  ttftMs?: number;
  durationMs: number;
  finishReason?: string;
}

/**
 * Streams one completion. Thinking arrives either as `reasoning_content`
 * (LM Studio's "separate reasoning" setting) or inline `<think>` tags; both are
 * surfaced as `thinking` events. Returns the final text and tool calls.
 */
export async function streamCompletion(
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
  thinking?: ThinkingLevel,
): Promise<{ text: string; toolCalls: ToolCall[]; stats: StepStats }> {
  const base = { model, messages, tools, tool_choice: "auto", stream: true, temperature: TEMPERATURE };
  // LM Studio ignores or rejects reasoning controls depending on version and model,
  // so try the full set first, then progressively plainer requests. Each attempt also
  // asks for a usage chunk (token counts); the last one drops every extra.
  const attempts = [...thinkingAttempts(thinking).map((e) => ({ ...e, stream_options: { include_usage: true } })), {}];
  let res: Response | undefined;
  let used: Record<string, unknown> = {};
  let t0 = performance.now();
  for (const extras of attempts) {
    used = extras;
    t0 = performance.now();
    try {
      res = await fetch(`${LMSTUDIO_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, ...extras }),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new AgentError("server_stopped", STATUS_MESSAGES.server_stopped);
    }
    if (res.status !== 400 && res.status !== 422) break;
    // Rejected: retry with fewer extras, but only if there are some left to drop.
    if (Object.keys(extras).length === 0) break;
    await res.body?.cancel().catch(() => {});
  }
  if (!res || !res.ok || !res.body) {
    if (!res) throw new AgentError("server_stopped", STATUS_MESSAGES.server_stopped);
    const detail = await res.text().catch(() => "");
    if (/no model|not loaded|model.*not found/i.test(detail)) throw new AgentError("no_model", STATUS_MESSAGES.no_model);
    throw new AgentError("model_error", `LM Studio returned ${res.status}. ${detail.slice(0, 240)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const stats: StepStats = {
    sent: Object.keys(used).filter((k) => k !== "stream_options").join("+") || "none",
    thinkingChars: 0,
    outputChars: 0,
    durationMs: 0,
  };
  const emit = (e: StreamEvent) => {
    if (e.kind === "thinking") stats.thinkingChars += e.text.length;
    else stats.outputChars += e.text.length;
    onEvent(e);
  };
  const think = new ThinkSplitter(emit);
  const calls = new Map<number, ToolCall>();
  let text = "";
  let buf = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: {
        error?: { message?: string } | string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
        choices?: { finish_reason?: string | null; delta?: { content?: string | null; reasoning_content?: string; reasoning?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.error) {
        const msg = typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? "Unknown error");
        throw new AgentError("model_error", msg);
      }
      const u = chunk.usage;
      if (u) {
        if (typeof u.prompt_tokens === "number") stats.promptTokens = u.prompt_tokens;
        if (typeof u.completion_tokens === "number") stats.completionTokens = u.completion_tokens;
        if (typeof u.completion_tokens_details?.reasoning_tokens === "number") stats.reasoningTokens = u.completion_tokens_details.reasoning_tokens;
      }
      const finish = chunk.choices?.[0]?.finish_reason;
      if (finish) stats.finishReason = finish;
      const d = chunk.choices?.[0]?.delta;
      if (!d) continue;
      const reasoning = d.reasoning_content ?? d.reasoning;
      if (stats.ttftMs === undefined && (reasoning || d.content || d.tool_calls?.length)) stats.ttftMs = Math.round(performance.now() - t0);
      if (reasoning) emit({ kind: "thinking", text: reasoning });
      if (d.content) text += think.push(d.content);
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
        calls.set(i, cur);
      }
    }
  }
  text += think.flush();
  const toolCalls = [...calls.values()]
    .filter((c) => c.function.name)
    .map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
  stats.durationMs = Math.round(performance.now() - t0);
  return { text: text.trim(), toolCalls, stats };
}

/** Sampling temperature for every completion (shown in the Debug panel). */
export const TEMPERATURE = 0.3;

/**
 * Request fields for each thinking level, most specific first.
 *  - `reasoning_effort`: LM Studio 0.4.8+ (values aren't documented for this endpoint).
 *  - `chat_template_kwargs.enable_thinking` / `enable_thinking`: Qwen3.5's own switch.
 * "on" and "auto" (undefined) send no effort level, since Qwen3.5 has no graded levels.
 */
function thinkingAttempts(level?: ThinkingLevel): Record<string, unknown>[] {
  if (!level) return [{}];
  const enabled = level !== "off";
  const kwargs = { chat_template_kwargs: { enable_thinking: enabled }, enable_thinking: enabled };
  const effort = level === "off" ? "none" : level === "on" ? undefined : level;
  return [effort ? { reasoning_effort: effort, ...kwargs } : kwargs, ...(effort ? [kwargs] : []), {}];
}

export class AgentError extends Error {
  constructor(
    public code: "server_stopped" | "no_model" | "model_error",
    message: string,
  ) {
    super(message);
  }
}

/** Separates `<think>…</think>` spans from visible text, even when tags are split across chunks. */
class ThinkSplitter {
  private inThink = false;
  private pending = "";
  constructor(private onEvent: (e: StreamEvent) => void) {}

  push(chunk: string): string {
    let s = this.pending + chunk;
    this.pending = "";
    let out = "";
    while (s.length) {
      const tag = this.inThink ? "</think>" : "<think>";
      const at = s.indexOf(tag);
      if (at >= 0) {
        this.emit(s.slice(0, at), (t) => (out += t));
        this.inThink = !this.inThink;
        s = s.slice(at + tag.length);
        continue;
      }
      // Hold back a possible partial tag at the end of the chunk.
      let keep = 0;
      for (let k = Math.min(tag.length - 1, s.length); k > 0; k--)
        if (tag.startsWith(s.slice(-k))) {
          keep = k;
          break;
        }
      this.emit(s.slice(0, s.length - keep), (t) => (out += t));
      this.pending = s.slice(s.length - keep);
      break;
    }
    return out;
  }

  flush() {
    const rest = this.pending;
    this.pending = "";
    if (this.inThink) {
      if (rest) this.onEvent({ kind: "thinking", text: rest });
      return "";
    }
    if (rest) this.onEvent({ kind: "text", text: rest });
    return rest;
  }

  private emit(t: string, visible: (t: string) => void) {
    if (!t) return;
    if (this.inThink) this.onEvent({ kind: "thinking", text: t });
    else {
      this.onEvent({ kind: "text", text: t });
      visible(t);
    }
  }
}
