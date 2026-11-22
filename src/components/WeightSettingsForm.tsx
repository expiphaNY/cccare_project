// =============================================================================
// WeightSettingsForm.tsx : FORM FOR THE CLINIC'S WEIGHT LIST
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Edits the list of weights the recorder offers, in kg or lb, and saves it through a server action.
// =============================================================================

"use client";

import { useState, useTransition } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { saveWeightSettingsAction } from "@/app/actions";
import { DEMO, DEMO_MSG } from "@/lib/demo";
import { fmtDateTime } from "@/lib/format";
import { DEFAULT_WEIGHTS, LB_PER_KG, type WeightSettings, type WeightUnit } from "@/lib/types";
import { Card, btn, cx } from "./ui";

const PRESETS: Record<WeightUnit, { label: string; options: number[] }[]> = {
  kg: [
    { label: "Rehab dumbbells", options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5] },
    { label: "Standard dumbbells", options: DEFAULT_WEIGHTS.options },
  ],
  lb: [
    { label: "Rehab dumbbells", options: [0, 1, 2, 3, 4, 5, 8, 10] },
    { label: "Standard dumbbells", options: [0, 2, 3, 5, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50] },
  ],
};

export function WeightSettingsForm({ initial }: { initial: WeightSettings }) {
  const [unit, setUnit] = useState<WeightUnit>(initial.unit);
  const [options, setOptions] = useState<number[]>(initial.options);
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirty = unit !== initial.unit || options.join() !== initial.options.join();

  const addValue = () => {
    const v = Number(add);
    if (add === "" || !Number.isFinite(v) || v < 0 || v > 200) return setMsg({ ok: false, text: "Enter a weight between 0 and 200." });
    setOptions((o) => [...new Set([...o, Math.round(v * 100) / 100])].sort((a, b) => a - b));
    setAdd("");
    setMsg(null);
  };
  const switchUnit = (u: WeightUnit) => {
    if (u === unit) return;
    // Convert and round to the nearest 0.5 so existing choices carry over sensibly.
    const f = u === "lb" ? LB_PER_KG : 1 / LB_PER_KG;
    setOptions((o) => [...new Set(o.map((x) => Math.round(x * f * 2) / 2))].sort((a, b) => a - b));
    setUnit(u);
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-medium">Unit</span>
        <div className="inline-flex rounded-full bg-canvas p-0.5" role="radiogroup" aria-label="Weight unit">
          {(["kg", "lb"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => switchUnit(u)}
              className={cx("pressable min-h-8 rounded-full px-4 text-[13px] font-medium", unit === u ? "bg-white text-ink shadow-sm" : "text-ink-2")}
            >
              {u}
            </button>
          ))}
        </div>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {PRESETS[unit].map((p) => (
            <button key={p.label} type="button" className={cx(btn.ghost, btn.small)} onClick={() => setOptions(p.options)}>
              <RotateCcw className="size-3.5" aria-hidden /> {p.label}
            </button>
          ))}
        </span>
      </div>

      <ul className="mt-5 flex flex-wrap gap-2" aria-label="Available weights">
        {options.map((w) => (
          <li key={w} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong bg-white pl-3 pr-1 text-[13px] font-medium tabular">
            {w === 0 ? "No weight" : `${w} ${unit}`}
            <button
              type="button"
              onClick={() => setOptions((o) => o.filter((x) => x !== w))}
              className="pressable rounded-full p-1 text-ink-3 hover:bg-bad-soft hover:text-bad"
              aria-label={`Remove ${w} ${unit}`}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
        <li>
          <form
            className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-line-strong pl-3 pr-1"
            onSubmit={(e) => {
              e.preventDefault();
              addValue();
            }}
          >
            <label className="sr-only" htmlFor="add-weight">
              Add weight in {unit}
            </label>
            <input
              id="add-weight"
              type="number"
              min={0}
              max={200}
              step={0.25}
              inputMode="decimal"
              value={add}
              onChange={(e) => setAdd(e.target.value)}
              placeholder="Add"
              className="w-16 bg-transparent text-[13px] tabular outline-none"
            />
            <span className="text-[13px] text-ink-3">{unit}</span>
            <button type="submit" className="pressable rounded-full p-1 text-brand hover:bg-brand-soft" aria-label="Add weight">
              <Plus className="size-3.5" aria-hidden />
            </button>
          </form>
        </li>
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
          disabled={pending || !dirty}
          className={btn.primary}
          onClick={() =>
            start(async () => {
              if (DEMO) return setMsg({ ok: false, text: DEMO_MSG });
              const r = await saveWeightSettingsAction(unit, options);
              setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
            })
          }
        >
          {pending ? "Saving…" : "Save weights"}
        </button>
        {msg && <span className={cx("text-[13px]", msg.ok ? "text-good" : "text-bad")}>{msg.text}</span>}
        <span className="ml-auto text-[12px] text-ink-3">
          {initial.updatedBy ? `Last changed ${fmtDateTime(initial.updatedAt)} by ${initial.updatedBy}` : "Using the default list"}
        </span>
      </div>
    </Card>
  );
}
