// =============================================================================
// target.ts : MARKING WHAT THE ASSISTANT CAN POINT AT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Marks an element so the assistant's highlight tool can find it. Spread it onto any element:
//     <Card {...agentTarget("signal-chart", "Signal chart")}>
// =============================================================================

export function agentTarget(id: string, label: string) {
  return { "data-agent-target": id, "data-agent-label": label } as Record<string, string>;
}

export const HIGHLIGHT_EVENT = "myocare:highlight";
/** Asks MyoMinion dock to open and send a request: detail = { prompt, mode? }. */
export const ASK_EVENT = "myocare:agent-ask";
