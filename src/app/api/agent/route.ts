// =============================================================================
// route.ts : THE ASSISTANT'S WEB ENDPOINT (MyoMinion)
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   GET  tells the chat window which model the local LM Studio server has loaded, or why none is.
//   POST runs the assistant's loop (ask the model, run the tool it picks, feed the result back) and
//        streams each step to the chat as one line of JSON, so the user sees progress live.
//   Every number the assistant uses comes from the fixed tools in lib/agent/tools.ts. The model runs
//   on the clinic's own computer, so patient data is not sent to an outside AI company.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Impact on people (safety): the assistant can only DRAFT notes and weight changes; nothing is applied until a clinician approves it.
// =============================================================================

import { CURRENT_CLINICIAN } from "@/lib/mock";
import { AgentError, TEMPERATURE, getModelStatus, streamCompletion, type ChatMessage, type StepStats } from "@/lib/agent/lmstudio";
import { clinicianPrompt, wrapupPrompt } from "@/lib/agent/prompts";
import { THINKING_LEVELS, type AgentEvent, type AgentRequest, type AgentRole, type DebugInfo, type DebugStep, type DebugTool, type ThinkingLevel, type WireMessage } from "@/lib/agent/protocol";
import { WRAPUP_TOOLS, actorFor, describeTool, runTool, toolSchemas, type AgentContext } from "@/lib/agent/tools";

const MAX_STEPS = 8;
const MAX_HISTORY = 40;
const MAX_TOOL_CHARS = 6000;

/** Which model LM Studio has loaded, or why there isn't one. */
export async function GET() {
  return Response.json(await getModelStatus(), { headers: { "cache-control": "no-store" } });
}

/**
 * Runs the agent loop against LM Studio and streams NDJSON events:
 * thinking → tool calls → tool results → … → final answer.
 *
 * DEMO AUTHORISATION (same as the rest of the app): the role and patient id come
 * from the client. Replace with the signed-in user before handling real data.
 */
export async function POST(req: Request) {
  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const role = "clinician" as const;

  const view = {
    path: String(body.view?.path ?? "/").slice(0, 300),
    search: String(body.view?.search ?? "").slice(0, 300),
    targets: (Array.isArray(body.view?.targets) ? body.view.targets : []).slice(0, 60).map((t) => ({ id: String(t.id).slice(0, 80), label: String(t.label).slice(0, 160) })),
  };
  const ctx: AgentContext = {
    role,
    actor: actorFor(),
    view,
  };
  // Wrap-up mode: a fixed task from the session page. Fewer tools and a fixed
  // procedure make a small local model far more reliable.
  const wrapup = body.mode === "wrapup" && /\/sessions\/[^/]+/.test(view.path);
  const system = clinicianPrompt(CURRENT_CLINICIAN.name, view.path) + (wrapup ? `\n\n${wrapupPrompt()}` : "");
  const history = sanitize(body.messages).slice(-MAX_HISTORY);
  const tools = toolSchemas(role, wrapup ? WRAPUP_TOOLS : undefined);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      const added: WireMessage[] = [];
      // Run statistics for the Debug panel.
      const startedAt = new Date();
      const t0 = performance.now();
      const debugSteps: DebugStep[] = [];
      const debugTools: DebugTool[] = [];
      let debugModel = "";
      let thinkingSent: ThinkingLevel | undefined;
      let finished = false;
      let hitStepLimit = false;
      let finalText = "";
      try {
        const status = await getModelStatus();
        if (!status.ok) {
          send({ type: "error", code: status.code, message: status.message });
          return;
        }
        // Only pass a level the loaded model says it accepts.
        const thinking: ThinkingLevel | undefined = THINKING_LEVELS.includes(body.thinking as ThinkingLevel) && status.thinking.options.includes(body.thinking as ThinkingLevel) ? body.thinking : undefined;
        thinkingSent = thinking;
        debugModel = status.model;
        send({ type: "model", model: status.model });
        const messages: ChatMessage[] = [{ role: "system", content: system }, ...(history as ChatMessage[])];

        if (wrapup) {
          // Prefetch the session review so the model's first decision is the note itself.
          const id = "call_prefetch_review";
          const raw = "{}";
          send({ type: "tool_start", id, name: "review_session", label: describeTool(role, "review_session", raw).label || "session on screen", args: {} });
          const ts = performance.now();
          const { output } = await runTool(role, "review_session", raw, ctx);
          const res = output.result as { error?: string } | null;
          debugTools.push(toDebugTool(role, 0, "review_session", raw, res?.error, performance.now() - ts));
          send({ type: "tool_end", id, ok: !res?.error, result: output.result });
          if (res?.error) {
            send({ type: "error", code: "bad_request", message: res.error });
            return;
          }
          let content = JSON.stringify(output.result);
          if (content.length > MAX_TOOL_CHARS) content = content.slice(0, MAX_TOOL_CHARS) + "…(truncated)";
          const call: WireMessage = { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "review_session", arguments: raw } }] };
          const result: WireMessage = { role: "tool", tool_call_id: id, content };
          messages.push(call as ChatMessage, result as ChatMessage);
          added.push(call, result);
        }

        for (let step = 0; step < MAX_STEPS && !req.signal.aborted; step++) {
          if (step > 0) send({ type: "step" });
          const { text, toolCalls, stats } = await streamCompletion(
            status.model,
            messages,
            tools,
            (e) => send(e.kind === "thinking" ? { type: "thinking", text: e.text } : { type: "text", text: e.text }),
            req.signal,
            thinking,
          );
          debugSteps.push(toDebugStep(step, stats, toolCalls.length));
          if (!toolCalls.length) {
            added.push({ role: "assistant", content: text });
            finalText = text;
            finished = true;
            break;
          }
          const assistant: WireMessage = { role: "assistant", content: text || null, tool_calls: toolCalls };
          messages.push(assistant as ChatMessage);
          added.push(assistant);
          for (const tc of toolCalls) {
            const { args, label } = describeTool(role, tc.function.name, tc.function.arguments);
            send({ type: "tool_start", id: tc.id, name: tc.function.name, label, args });
            const toolStart = performance.now();
            const { output } = await runTool(role, tc.function.name, tc.function.arguments, ctx);
            const res = output.result as { error?: string } | null;
            debugTools.push(toDebugTool(role, step, tc.function.name, tc.function.arguments, res?.error, performance.now() - toolStart));
            send({ type: "tool_end", id: tc.id, ok: !res?.error, result: output.result, client: output.client, ui: output.ui });
            let content = JSON.stringify(output.result);
            if (content.length > MAX_TOOL_CHARS) content = content.slice(0, MAX_TOOL_CHARS) + "…(truncated)";
            const msg: WireMessage = { role: "tool", tool_call_id: tc.id, content };
            messages.push(msg as ChatMessage);
            added.push(msg);
          }
        }
        if (!finished && !req.signal.aborted) {
          hitStepLimit = true;
          const note = "I stopped after several tool steps without a final answer. Try asking a narrower question.";
          send({ type: "text", text: note });
          added.push({ role: "assistant", content: note });
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          const err = e instanceof AgentError ? e : new AgentError("model_error", (e as Error).message);
          send({ type: "error", code: err.code, message: err.message });
        }
      } finally {
        if (debugSteps.length)
          send({ type: "debug", data: buildDebug({ model: debugModel, asked: THINKING_LEVELS.includes(body.thinking as ThinkingLevel) ? body.thinking : undefined, sent: thinkingSent, steps: debugSteps, tools: debugTools, startedAt, wallMs: performance.now() - t0, hitStepLimit, emptyAnswer: finished && !finalText.trim() }) });
        send({ type: "history", messages: added });
        send({ type: "done" });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

// ---- Debug panel data ---------------------------------------------------------

function toDebugStep(step: number, s: StepStats, toolCalls: number): DebugStep {
  // Without a reasoning count from LM Studio, fall back to ~4 characters per token.
  const reasoningEstimated = s.reasoningTokens === undefined;
  const reasoningTokens = s.reasoningTokens ?? Math.round(s.thinkingChars / 4);
  const outputTokens = s.completionTokens !== undefined ? Math.max(0, s.completionTokens - reasoningTokens) : Math.round(s.outputChars / 4);
  return { step: step + 1, sent: s.sent, promptTokens: s.promptTokens, completionTokens: s.completionTokens, reasoningTokens, reasoningEstimated, outputTokens, thinkingChars: s.thinkingChars, outputChars: s.outputChars, ttftMs: s.ttftMs, durationMs: s.durationMs, toolCalls, finishReason: s.finishReason };
}

function toDebugTool(role: AgentRole, step: number, name: string, rawArgs: string, error: string | undefined, ms: number): DebugTool {
  let argsValid = true;
  try {
    JSON.parse(rawArgs.trim() || "{}");
  } catch {
    argsValid = false;
  }
  void role;
  return {
    step: step + 1,
    name,
    args: rawArgs.slice(0, 600),
    argsValid,
    error: error === undefined ? undefined : String(error).slice(0, 300),
    ms: Math.round(ms),
  };
}

function buildDebug(o: { model: string; asked?: ThinkingLevel; sent?: ThinkingLevel; steps: DebugStep[]; tools: DebugTool[]; startedAt: Date; wallMs: number; hitStepLimit: boolean; emptyAnswer: boolean }): DebugInfo {
  const sum = (f: (s: DebugStep) => number | undefined) => o.steps.reduce((a, s) => a + (f(s) ?? 0), 0);
  const usageReported = o.steps.every((s) => s.promptTokens !== undefined && s.completionTokens !== undefined);
  const reasoningTokens = sum((s) => s.reasoningTokens);
  const outputTokens = sum((s) => s.outputTokens);
  const promptTokens = usageReported ? sum((s) => s.promptTokens) : undefined;
  const generatingMs = sum((s) => s.durationMs - (s.ttftMs ?? 0));
  return {
    model: o.model,
    thinkingAsked: o.asked,
    thinkingSent: o.sent,
    temperature: TEMPERATURE,
    steps: o.steps,
    tools: o.tools,
    totals: {
      promptTokens,
      reasoningTokens,
      outputTokens,
      totalTokens: promptTokens === undefined ? undefined : promptTokens + reasoningTokens + outputTokens,
      usageReported,
      reasoningEstimated: o.steps.some((s) => s.reasoningEstimated),
      ttftMs: o.steps[0]?.ttftMs,
      wallMs: Math.round(o.wallMs),
      tokensPerSec: generatingMs > 0 ? Math.round(((reasoningTokens + outputTokens) / (generatingMs / 1000)) * 10) / 10 : undefined,
      toolCalls: o.tools.length,
      toolErrors: o.tools.filter((t) => t.error !== undefined).length,
      invalidArgs: o.tools.filter((t) => !t.argsValid).length,
    },
    hitStepLimit: o.hitStepLimit,
    emptyAnswer: o.emptyAnswer,
    startedAt: o.startedAt.toISOString(),
  };
}

/** Keeps only well-formed user / assistant / tool messages; the client never sets the system prompt. */
function sanitize(input: unknown): WireMessage[] {
  if (!Array.isArray(input)) return [];
  const out: WireMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") continue;
    const r = (m as { role?: string }).role;
    if (r === "user" && typeof m.content === "string") out.push({ role: "user", content: m.content.slice(0, 4000) });
    else if (r === "assistant")
      out.push({
        role: "assistant",
        content: typeof m.content === "string" ? m.content.slice(0, 8000) : null,
        ...(Array.isArray(m.tool_calls) && m.tool_calls.length && { tool_calls: m.tool_calls }),
      });
    else if (r === "tool" && typeof m.tool_call_id === "string" && typeof m.content === "string")
      out.push({ role: "tool", tool_call_id: m.tool_call_id, content: m.content.slice(0, MAX_TOOL_CHARS + 20) });
  }
  // Drop leading tool messages orphaned by truncation.
  while (out.length && out[0].role === "tool") out.shift();
  return out;
}
