/**
 * Static, read-only demo build (GitHub Pages). `npm run build:pages` sets these;
 * Next inlines `NEXT_PUBLIC_*` at build time, so the flag is a compile-time constant.
 *
 * In demo mode there is no server: pages are prerendered from the built-in mock
 * data, writes are disabled, and signals are regenerated in the browser.
 */
export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** Sub-path the site is served from, e.g. "/care_project" (empty for a user/org site). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const DEMO_MSG = "This is a read-only demo, so nothing is saved";
