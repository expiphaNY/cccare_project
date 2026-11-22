// =============================================================================
// WrapUpButton.tsx : ONE-CLICK SESSION WRAP-UP
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   The button on a session page that asks the assistant to review the session and draft the note (and a weight change if the rules call for one).
// =============================================================================

"use client";

import { Sparkles } from "lucide-react";
import { WRAPUP_PROMPT } from "@/lib/agent/protocol";
import { ASK_EVENT } from "@/lib/agent/target";
import { DEMO } from "@/lib/demo";
import { btn, cx } from "../ui";

/** One click: MyoMinion reviews this session and drafts the note (and a weight change if the rules call for one). */
export function WrapUpButton() {
  if (DEMO) return null;
  return (
    <button
      type="button"
      className={cx(btn.primary, btn.small, "min-h-9")}
      title="MyoMinion drafts a SOAP note from this session's verified reps, weights and shakiness, plus a weight change if the progression rules recommend one. Nothing is saved until you approve it in Drafts."
      onClick={() => window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { prompt: WRAPUP_PROMPT, mode: "wrapup" } }))}
    >
      <Sparkles className="size-3.5" aria-hidden /> Wrap up with MyoMinion
    </button>
  );
}
