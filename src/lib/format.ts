// =============================================================================
// format.ts : DATES, TIMES AND NAMES AS TEXT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Small functions that turn dates, times, ages, percentages and names into the text shown on screen, all in one time zone so every page agrees.
// =============================================================================

const TZ = "America/Toronto";

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = {}) {
  // Date-only values (e.g. birth dates) are calendar dates, not instants.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Date(dateOnly ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : TZ,
    ...opts,
  });
}

export function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: TZ });
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fmtDateTime(iso: string) {
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

/**
 * The name shown for a session. A session is named "<what the clinician typed> · <time>", and when
 * nothing was typed the date stands in for it: "Nov 22, 2026 · 4:35 PM". Sessions saved before
 * naming existed have no stored name, so the same default is built from their start time.
 */
export function sessionName(s: { name?: string; startedAt: string }) {
  return s.name?.trim() || defaultSessionName(s.startedAt);
}

/** The name without its time ("Nov 22, 2026" or "Elbow rehab"), for tables that show the time in its own line. */
export function sessionTitle(s: { name?: string; startedAt: string }) {
  const n = sessionName(s);
  const i = n.lastIndexOf(" · ");
  return i > 0 ? n.slice(0, i) : n;
}

/** True when the session still has its default name (the date), so it was never given a name of its own. */
export function hasDefaultSessionName(s: { name?: string; startedAt: string }) {
  return sessionName(s) === defaultSessionName(s.startedAt);
}

/** Builds the name that gets stored: the typed text (or the date) followed by the start time. */
export function defaultSessionName(startedAt: string, typed?: string) {
  const label = typed?.trim().slice(0, SESSION_NAME_MAX) || fmtDate(startedAt);
  return `${label} · ${fmtTime(startedAt)}`;
}

/** Longest name the clinician may type (the time is added after it). */
export const SESSION_NAME_MAX = 60;

export function ageFrom(dob: string, now = new Date()) {
  const d = new Date(`${dob}T00:00:00Z`);
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export function relTime(iso: string, now = Date.now()) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), "minute");
  if (abs < 864e5) return rtf.format(Math.round(diff / 3600e3), "hour");
  if (abs < 30 * 864e5) return rtf.format(Math.round(diff / 864e5), "day");
  return rtf.format(Math.round(diff / (30 * 864e5)), "month");
}

/** Milliseconds since the given time (request-time helper for server components). */
export function msSince(iso: string) {
  return Date.now() - new Date(iso).getTime();
}

export function pct(n: number, digits = 0) {
  const s = n.toFixed(digits);
  return `${n > 0 ? "+" : ""}${s}%`;
}

export function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`;
}

export function initials(p: { firstName: string; lastName: string }) {
  return `${p.firstName[0]}${p.lastName[0]}`;
}
