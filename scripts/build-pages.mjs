// Builds the static, read-only demo into web/out for GitHub Pages.
//
//   NEXT_PUBLIC_BASE_PATH=/repo-name npm run build:pages
//
// A static export can't contain API routes, so for the duration of the build this
// moves src/app/api out of the way and adds the demo-only signal manifest route.
// Both are undone afterwards (and on the next run if this is killed mid-build),
// as are the tsconfig / next-env.d.ts edits Next makes while building.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (...a) => join(root, ...a);

const stash = p(".pages-stash");
const api = p("src/app/api");
const stashedApi = join(stash, "api");
const demoRoute = p("src/app/demo-signals.json");
// Next rewrites these to point at the build's distDir; put them back afterwards.
const rewritten = ["tsconfig.json", "tsconfig.pages.json", "next-env.d.ts"].filter((f) => existsSync(p(f)));

function restore() {
  rmSync(demoRoute, { recursive: true, force: true });
  for (const f of rewritten) if (existsSync(join(stash, f))) copyFileSync(join(stash, f), p(f));
  if (existsSync(stashedApi)) {
    if (existsSync(api)) rmSync(api, { recursive: true, force: true });
    renameSync(stashedApi, api);
  }
  rmSync(stash, { recursive: true, force: true });
}

restore(); // recover from an interrupted run
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (restore(), process.exit(130)));

let status = 1;
try {
  mkdirSync(stash, { recursive: true });
  for (const f of rewritten) copyFileSync(p(f), join(stash, f));
  if (existsSync(api)) renameSync(api, stashedApi);
  mkdirSync(demoRoute, { recursive: true });
  cpSync(p("src/lib/demo/routes/demo-signals.json/route.ts"), join(demoRoute, "route.ts"));

  rmSync(p("out"), { recursive: true, force: true });
  const res = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_DEMO: "1", NEXT_TELEMETRY_DISABLED: "1" },
  });
  status = res.status ?? 1;
  // Pages runs Jekyll by default, which drops the _next/ directory.
  if (status === 0) writeFileSync(p("out/.nojekyll"), "");
} finally {
  restore();
  // Generated types describe the demo's routes (no /api); drop them so the full app regenerates its own.
  rmSync(p(".next/types"), { recursive: true, force: true });
}
process.exit(status);
