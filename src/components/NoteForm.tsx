"use client";

import { useState, useTransition } from "react";
import { addNoteAction } from "@/app/actions";
import { DEMO } from "@/lib/demo";
import { btn, cx } from "./ui";

export function NoteForm({ patientId, sessionId }: { patientId: string; sessionId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  if (DEMO) return <p className="mt-4 text-[13px] text-ink-3">Notes can’t be added in the read-only demo.</p>;
  return (
    <form
      className="mt-4 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        start(async () => {
          await addNoteAction(patientId, sessionId, text);
          setText("");
        });
      }}
    >
      <label className="sr-only" htmlFor={`note-${sessionId}`}>
        Add a note
      </label>
      <input
        id={`note-${sessionId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note (visible to the patient)"
        className="min-h-10 flex-1 rounded-full border border-line-strong px-4 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
      />
      <button type="submit" disabled={pending || !text.trim()} className={cx(btn.primary, btn.small, "min-h-10")}>
        {pending ? "Saving…" : "Add note"}
      </button>
    </form>
  );
}
