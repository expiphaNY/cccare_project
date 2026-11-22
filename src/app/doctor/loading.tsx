// =============================================================================
// loading.tsx : LOADING SCREEN
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Next.js shows this page-shaped skeleton at once while the clinician pages load, so nothing looks frozen.
// =============================================================================

import { PageSkeleton } from "@/components/Loading";

export default function Loading() {
  return <PageSkeleton />;
}
