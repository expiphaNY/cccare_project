"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Link2, Search } from "lucide-react";
import type { Status } from "@/lib/analytics";
import { Segmented } from "./Segmented";
import { Sparkline } from "./charts/Sparkline";
import { Avatar, Delta, StatusBadge } from "./ui";

export interface PatientRow {
  id: string;
  name: string;
  initials: string;
  age: number;
  sex: string;
  condition: string;
  side: string;
  primaryExercise: string;
  lastSession: string | null;
  lastSessionRel: string;
  sessions: number;
  trend: number[];
  changePct: number | null;
  status: Status;
  activeShares: number;
}

export function PatientTable({ rows }: { rows: PatientRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [sort, setSort] = useState<"attention" | "name" | "recent">("attention");

  const shown = useMemo(() => {
    const rank: Record<Status, number> = { declining: 0, steady: 1, new: 2, improving: 3 };
    return rows
      .filter((r) => (filter === "all" ? true : r.status === filter))
      .filter((r) => {
        const s = q.trim().toLowerCase();
        return !s || r.name.toLowerCase().includes(s) || r.condition.toLowerCase().includes(s);
      })
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name)
          : sort === "recent"
            ? (b.lastSession ?? "").localeCompare(a.lastSession ?? "")
            : rank[a.status] - rank[b.status] || a.name.localeCompare(b.name),
      );
  }, [rows, q, filter, sort]);

  const count = (s: Status) => rows.filter((r) => r.status === s).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-5 pb-4 pt-5 sm:px-6">
        <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <span className="sr-only">Search patients</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or condition"
            className="min-h-10 w-full rounded-full border border-line-strong bg-white pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </label>
        <Segmented
          label="Filter by status"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All ${rows.length}` },
            { value: "declining", label: `Declining ${count("declining")}` },
            { value: "steady", label: `Plateau ${count("steady")}` },
            { value: "improving", label: `Improving ${count("improving")}` },
          ]}
        />
        <label className="ml-auto flex items-center gap-2 text-[13px] text-ink-2">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="min-h-9 cursor-pointer rounded-full border border-line-strong bg-white px-3 text-[13px] text-ink outline-none focus:border-brand"
          >
            <option value="attention">Needs attention first</option>
            <option value="recent">Most recent session</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-y border-line bg-canvas/60 text-left text-[12px] text-ink-2">
              <th className="px-5 py-2.5 font-medium sm:px-6">Patient</th>
              <th className="px-3 py-2.5 font-medium">Condition</th>
              <th className="px-3 py-2.5 font-medium">Last session</th>
              <th className="px-3 py-2.5 font-medium">Peak activation trend</th>
              <th className="px-3 py-2.5 text-right font-medium">Since baseline</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="group relative border-b border-line last:border-b-0 hover:bg-brand-tint/60">
                <td className="px-5 py-3 sm:px-6">
                  <Link href={`/doctor/patients/${r.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                    <Avatar text={r.initials} size="sm" />
                    <span>
                      <span className="block font-medium text-ink">{r.name}</span>
                      <span className="block text-[12px] text-ink-2">
                        {r.age} y · {r.sex} {r.activeShares > 0 && <Link2 className="ml-1 inline size-3 text-warn" aria-label={`${r.activeShares} active share link`} />}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className="block text-ink">{r.condition}</span>
                  <span className="block text-[12px] capitalize text-ink-2">{r.side} · {r.primaryExercise}</span>
                </td>
                <td className="px-3 py-3">
                  <span className="block text-ink tabular">{r.lastSessionRel}</span>
                  <span className="block text-[12px] text-ink-2">{r.sessions} sessions</span>
                </td>
                <td className="px-3 py-3">
                  <Sparkline values={r.trend} color={r.status === "declining" ? "#9a5500" : "#0b63ce"} />
                </td>
                <td className="px-3 py-3 text-right">{r.changePct == null ? <span className="text-ink-3">–</span> : <Delta value={r.changePct} />}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-3 text-ink-3">
                  <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm text-ink-2">
                  No patients match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
