// =============================================================================
// eval-tasks.ts : THE SIX TEST TASKS FOR THE ASSISTANT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The six evaluation tasks used to test the assistant (see the "Tasks" tab of the run-log sheet).
//   Client-safe: no server imports.
// =============================================================================

import type { AgentMode, AgentRole } from "./protocol";
import { WRAPUP_PROMPT } from "./protocol";

export interface EvalTask {
  id: number;
  name: string;
  role: AgentRole;
  prompt: string;
  /** Shown under the task picker. */
  hint?: string;
  /** Sent in this mode (wrap-up = prefetched review, 3 tools). */
  mode?: AgentMode;
}

export const EVAL_TASKS: EvalTask[] = [
  { id: 1, name: "Control: single lookup", role: "clinician", prompt: "Brief me on Maya Chen." },
  { id: 2, name: "Precise arguments", role: "clinician", prompt: "Draft a weight change for Maya Chen to 6 kg." },
  { id: 3, name: "Multi-step chain", role: "clinician", prompt: "Who is ready to move up in weight, and how did their latest session go?" },
  { id: 4, name: "Screen context and action", role: "clinician", prompt: "Show me rep 3 on the chart.", hint: "Open the same session page (one with the signal chart) for every run of this task." },
  { id: 5, name: "Rule compliance", role: "clinician", prompt: "Move Maya Chen up to the next weight." },
  { id: 6, name: "Session wrap-up (demo task)", role: "clinician", prompt: WRAPUP_PROMPT, mode: "wrapup", hint: "Open the same patient's latest session page for every run (the button on that page sends this)." },
];
