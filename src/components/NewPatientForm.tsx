"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPatientAction } from "@/app/actions";
import { btn } from "./ui";

const input =
  "mt-1.5 block min-h-11 w-full rounded-xl border border-line-strong bg-white px-3 text-[15px] outline-none focus:border-brand focus:ring-4 focus:ring-brand/15";

export function NewPatientForm({ exercises }: { exercises: { key: string; name: string; muscle: string }[] }) {
  const [state, action, pending] = useActionState(createPatientAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.id) router.push(`/doctor/patients/${state.id}`);
  }, [state, router]);

  return (
    <form action={action} className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Identity</legend>
        <label className="text-sm font-medium">
          First name
          <input name="firstName" required autoComplete="off" className={input} />
        </label>
        <label className="text-sm font-medium">
          Last name
          <input name="lastName" required autoComplete="off" className={input} />
        </label>
        <label className="text-sm font-medium">
          Date of birth
          <input name="dob" type="date" required className={input} />
        </label>
        <label className="text-sm font-medium">
          Sex
          <select name="sex" className={input} defaultValue="female">
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other / prefer not to say</option>
          </select>
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Clinical</legend>
        <label className="text-sm font-medium sm:col-span-2">
          Condition being treated
          <input name="condition" required placeholder="e.g. Distal biceps tendon repair" className={input} />
        </label>
        <label className="text-sm font-medium">
          Affected side
          <select name="side" className={input} defaultValue="right">
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="bilateral">Bilateral</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Goal <span className="font-normal text-ink-3">(in the patient’s words)</span>
          <input name="goal" className={input} />
        </label>
        <div className="sm:col-span-2">
          <div className="text-sm font-medium">Exercise to measure</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {exercises.map((e) => (
              <label key={e.key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 hover:border-line-strong has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
                <input type="checkbox" name="exercises" value={e.key} defaultChecked={exercises.length === 1} className="accent-[#0b63ce]" />
                <span className="text-sm">
                  {e.name} <span className="text-ink-3">· {e.muscle}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-2xl bg-brand-tint p-4">
        <legend className="sr-only">Consent</legend>
        <div className="text-sm font-semibold">Consent (confirm with the patient)</div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" className="mt-1 accent-[#0b63ce]" />
          <span>
            Patient agrees to EMG data being collected and stored for their care. <span className="text-ink-2">Required.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="careTeam" defaultChecked className="mt-1 accent-[#0b63ce]" />
          <span>Other clinicians in this clinic may view when covering care.</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="research" className="mt-1 accent-[#0b63ce]" />
          <span>De-identified data may be used for research. (Off unless the patient asks.)</span>
        </label>
      </fieldset>

      {state?.error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={btn.primary}>
          {pending ? "Creating…" : "Create profile"}
        </button>
      </div>
    </form>
  );
}
