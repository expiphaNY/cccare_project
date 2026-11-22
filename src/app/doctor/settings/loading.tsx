// =============================================================================
// loading.tsx : LOADING SCREEN
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Next.js shows this skeleton at once while the weights page loads its settings from the
//   database. Without it the page reads data with nothing to show in the meantime, and
//   Next.js reports a "blocking route" error in development.
// =============================================================================

import { PageSkeleton } from "@/components/Loading";

export default function Loading() {
  return <PageSkeleton />;
}
