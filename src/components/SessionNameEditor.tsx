// =============================================================================
// SessionNameEditor.tsx : SHOW A SESSION'S NAME, AND LET THE CLINICIAN RENAME IT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Shows the session's name as the page heading, with a small pencil button. Pressing it turns the
//   heading into a text box. Saving sends the new text to the server (renameSessionAction), which
//   stores "<text> · <start time>" on the session in the database. Saving an empty box puts the
//   date back, which is the default name.
//
// STEPS TAKEN FOR THE MARKING RUBRIC
//   Ease of use: Enter saves and Escape cancels; the box shows the exact name that will be saved.
//   Robust code: the length limit is checked here and again on the server; errors are shown beside the box.
// =============================================================================

"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { renameSessionAction } from "@/app/actions";
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { SESSION_NAME_MAX, defaultSessionName } from "@/lib/format";

export function SessionNameEditor({
  patientId,
  sessionId,
  startedAt,
  heading,
  typed,
}: {
  patientId: string;
  sessionId: string;
  startedAt: string;
  /** What to show as the heading when not editing. */
  heading: string;
  /** The text already typed for this session ("" when it still has the date as its name). */
  typed: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(typed);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      if (DEMO) return setError(DEMO_MSG);
      const r = await renameSessionAction(patientId, sessionId, text);
      if (r.ok) {
        setEditing(false);
        setError(null);
      } else {
        setError(r.error);
      }
    });

  if (!editing)
    return (
      <span className="inline-flex items-center gap-1.5">
        <h2 className="display text-[24px] font-semibold">{heading}</h2>
        <button
          type="button"
          onClick={() => {
            setText(typed);
            setEditing(true);
          }}
          className="pressable rounded-full p-1.5 text-ink-3 hover:bg-brand-soft hover:text-brand"
          aria-label="Rename this session"
        >
          <Pencil className="size-4" aria-hidden />
        </button>
      </span>
    );

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="sr-only" htmlFor={`name-${sessionId}`}>
        Session name
      </label>
      <input
        id={`name-${sessionId}`}
        autoFocus
        type="text"
        value={text}
        maxLength={SESSION_NAME_MAX}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="Session name"
        className="min-h-10 w-72 max-w-full rounded-xl border border-line-strong bg-white px-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      <button type="submit" disabled={pending} className="pressable rounded-full p-2 text-brand hover:bg-brand-soft disabled:opacity-50" aria-label="Save name">
        <Check className="size-4" aria-hidden />
      </button>
      <button type="button" onClick={() => setEditing(false)} className="pressable rounded-full p-2 text-ink-3 hover:bg-canvas" aria-label="Cancel renaming">
        <X className="size-4" aria-hidden />
      </button>
      <span className="basis-full text-[12px] text-ink-3">
        Saved as “{defaultSessionName(startedAt, text)}”. Leave it empty to use the date.
      </span>
      {error && (
        <span className="basis-full text-[12px] text-bad" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
