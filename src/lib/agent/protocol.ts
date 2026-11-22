// =============================================================================
// protocol.ts : THE MESSAGE FORMAT BETWEEN THE CHAT AND THE SERVER
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The wire format between /api/agent and the chat window: newline-delimited JSON events (a step
//   started, a tool ran, text arrived, a draft was made ...). Safe to import from client components.
// =============================================================================

/** Clinician-only app; kept as a type so stored eval runs stay readable. */
export type AgentRole = "clinician";

/**
 * How much the model should think. Qwen3.5 9B only has on/off; LM Studio lists
 * the options each loaded model accepts, so the UI offers only those.
 */
export type ThinkingLevel = "off" | "on" | "low" | "medium" | "high";
export const THINKING_LEVELS: ThinkingLevel[] = ["off", "on", "low", "medium", "high"];

export interface ThinkingInfo {
  /** "reported": LM Studio listed these options for the model. "unconfirmed": it did not, so on/off is offered as a best guess. */
  source: "reported" | "unconfirmed";
  options: ThinkingLevel[];
  /** Model default, if LM Studio reported one. */
  default?: ThinkingLevel;
}

/** An on-screen element the assistant may spotlight (from `data-agent-target`). */
export interface PageTarget {
  id: string;
  label: string;
}

export type ClientAction = {
  type: "highlight";
  target: string;
  caption: string;
  /** Signal chart only: 1-based repetition to zoom to. */
  rep?: number;
  /** Signal chart only: time span in seconds. */
  start?: number;
  end?: number;
};

/** A draft the assistant saved for the clinician to approve. */
export type ToolUi = { kind: "draft"; id: string; title: string; href: string };

/** OpenAI-style history the client sends back each turn (no reasoning). */
export type WireMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** One model call inside a turn (a turn has several when the model calls tools). */
export interface DebugStep {
  step: number;
  /** Request fields LM Studio accepted for this call, e.g. "reasoning_effort+chat_template_kwargs". "none" = a plain request. */
  sent: string;
  promptTokens?: number;
  /** Everything the model generated: reasoning + visible output. Undefined when LM Studio sent no usage. */
  completionTokens?: number;
  reasoningTokens: number;
  /** True when LM Studio reported no reasoning count, so this is characters / 4. */
  reasoningEstimated: boolean;
  outputTokens: number;
  thinkingChars: number;
  outputChars: number;
  /** Time from sending the request to the first streamed token. */
  ttftMs?: number;
  durationMs: number;
  toolCalls: number;
  finishReason?: string;
}

export interface DebugTool {
  step: number;
  name: string;
  /** Raw JSON arguments the model produced (hidden for a patient's write_suggestion). */
  args: string;
  argsValid: boolean;
  error?: string;
  ms: number;
}

/** Everything needed to grade one run, sent once after the answer is complete. */
export interface DebugInfo {
  model: string;
  /** Level the chat UI asked for (undefined = model default). */
  thinkingAsked?: ThinkingLevel;
  /** Level actually sent on to LM Studio, after checking the loaded model supports it. */
  thinkingSent?: ThinkingLevel;
  temperature: number;
  steps: DebugStep[];
  tools: DebugTool[];
  totals: {
    promptTokens?: number;
    reasoningTokens: number;
    outputTokens: number;
    totalTokens?: number;
    /** True when every step reported usage; otherwise token counts are character estimates. */
    usageReported: boolean;
    reasoningEstimated: boolean;
    ttftMs?: number;
    wallMs: number;
    tokensPerSec?: number;
    toolCalls: number;
    toolErrors: number;
    invalidArgs: number;
  };
  hitStepLimit: boolean;
  emptyAnswer: boolean;
  startedAt: string;
}

export type AgentEvent =
  | { type: "model"; model: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  /** A new model step started (after tool results); text/thinking that follow belong to it. */
  | { type: "step" }
  | { type: "tool_start"; id: string; name: string; label: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; ok: boolean; result: unknown; client?: ClientAction; ui?: ToolUi }
  | { type: "history"; messages: WireMessage[] }
  /** Run statistics, sent just before `done`. The chat UI shows it only when Debug is on. */
  | { type: "debug"; data: DebugInfo }
  | { type: "error"; code: "server_stopped" | "no_model" | "model_error" | "bad_request"; message: string }
  | { type: "done" };

export interface AgentRequest {
  role: AgentRole;
  patientId?: string;
  messages: WireMessage[];
  /** Omitted = the model's own default. */
  thinking?: ThinkingLevel;
  view: { path: string; search: string; targets: PageTarget[] };
  /** "wrapup": session wrap-up from the session page's button (prefetched review, 3 tools). */
  mode?: AgentMode;
}

export type AgentMode = "wrapup";

/** The fixed request the session page's wrap-up button sends. */
export const WRAPUP_PROMPT = "Wrap up this session: draft the SOAP note, and propose a weight change only if the review recommends one.";
