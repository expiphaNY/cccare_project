import type { NextConfig } from "next";

/**
 * `npm run build:pages` (scripts/build-pages.mjs) sets NEXT_PUBLIC_DEMO=1 to
 * produce a static, read-only demo for GitHub Pages. Everything else is the
 * normal full-stack app.
 */
const demo = process.env.NEXT_PUBLIC_DEMO === "1";

const rules = {
  "*.css": {
    loaders: ["@tailwindcss/turbopack"],
    as: "*.css",
  },
};

const nextConfig: NextConfig = demo
  ? {
      output: "export",
      // Type-check without .next/dev/types, which describes the full app's API routes.
      typescript: { tsconfigPath: "tsconfig.pages.json" },
      // "/repo-name" on github.io/<user>/<repo>; empty for a user site or custom domain.
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true, // /doctor/ -> doctor/index.html, which Pages serves without rewrites
      images: { unoptimized: true },
      turbopack: {
        rules,
        // Server actions can't exist in a static export; swap in read-only stubs.
        resolveAlias: { "@/app/actions": "./src/lib/demo/actions.ts" },
      },
    }
  : {
      cacheComponents: true,
      partialPrefetching: true,
      turbopack: { rules },
    };

export default nextConfig;
