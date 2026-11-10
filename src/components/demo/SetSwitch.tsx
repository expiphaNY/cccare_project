"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Static demo only. A static export can't read `?set=` on the server, so the
 * page prerenders one view per set and this picks the one named in the URL.
 * The default view doubles as the Suspense fallback, so the HTML is never empty.
 */
export function SetSwitch({ variants }: { variants: Record<string, ReactNode> }) {
  return (
    <Suspense fallback={variants.default}>
      <Pick variants={variants} />
    </Suspense>
  );
}

function Pick({ variants }: { variants: Record<string, ReactNode> }) {
  const set = useSearchParams().get("set");
  return <>{(set && variants[set]) || variants.default}</>;
}
