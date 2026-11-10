import { TriangleAlert } from "lucide-react";
import { DEMO } from "@/lib/demo";
import { getStoreFallback } from "@/lib/store";

/** Dev-only banner: shown when MongoDB is configured but unreachable. */
export async function StoreWarning() {
  if (DEMO)
    return (
      <div role="status" className="border-b border-brand/15 bg-brand-soft text-brand-strong">
        <p className="mx-auto max-w-7xl px-4 py-2 text-center text-[13px] sm:px-6 lg:px-8">
          <b className="font-semibold">Read-only demo.</b> Sample data only — nothing you do here is saved, and there is no real patient information.
        </p>
      </div>
    );
  const reason = await getStoreFallback();
  if (!reason) return null;
  return (
    <div role="status" className="border-b border-warn/25 bg-warn-soft text-warn">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-3 text-sm sm:px-6 lg:px-8">
        <TriangleAlert className="mt-0.5 size-[18px] shrink-0" strokeWidth={2.2} aria-hidden />
        <div className="min-w-0">
          <p>
            <b className="font-semibold">Not saving to MongoDB.</b> The database couldn’t be reached, so changes are going to
            the local file store (<code className="font-mono text-[13px]">.data/store.json</code>) instead. If you use Atlas, add
            this computer’s IP under <b className="font-semibold">Network Access</b>, then restart{" "}
            <code className="font-mono text-[13px]">npm run dev</code>.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer text-[13px] font-medium">Error details</summary>
            <p className="mt-1 break-words font-mono text-[12px]">{reason}</p>
          </details>
        </div>
      </div>
    </div>
  );
}
