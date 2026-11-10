import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/nav";
import { ButtonLink, Card, PageContainer } from "@/components/ui";
import { DEMO } from "@/lib/demo";
import { fmtDateTime } from "@/lib/format";
import { getStore } from "@/lib/store";

export const metadata = { title: "Profile deleted" };

export default async function Deleted({ searchParams }: PageProps<"/deleted">) {
  const sp: Record<string, string | string[] | undefined> = DEMO ? {} : await searchParams;
  const store = await getStore();
  const receipt = (await store.listDeletionReceipts()).find((r) => r.id === sp.r);
  const fromClinician = sp.from === "clinician";
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center px-4 sm:px-6">
        <Logo />
      </header>
      <PageContainer className="max-w-xl pt-10">
        <Card className="p-8">
          <CheckCircle2 className="size-10 text-good" aria-hidden />
          <h1 className="display mt-4 text-[28px] font-semibold">Profile deleted</h1>
          {receipt ? (
            <>
              <p className="mt-2 text-ink-2">
                Removed {receipt.counts.sessions} sessions, {receipt.counts.recordings} recorded sets and their signals, {receipt.counts.shares} share links
                (they no longer open) and {receipt.counts.auditEvents} access-log entries.
              </p>
              <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-2xl bg-canvas p-4 text-sm">
                <dt className="text-ink-2">Receipt</dt>
                <dd className="font-mono">{receipt.id}</dd>
                <dt className="text-ink-2">Deleted</dt>
                <dd>{fmtDateTime(receipt.deletedAt)}</dd>
                <dt className="text-ink-2">Requested by</dt>
                <dd>{receipt.deletedBy.name}</dd>
                <dt className="text-ink-2">Record reference</dt>
                <dd className="break-all font-mono text-[12px]">{receipt.patientRef}</dd>
              </dl>
              <p className="mt-4 text-[13px] text-ink-2">
                This receipt holds no name or health data. The record reference is a one-way hash, so it can confirm deletion if asked, but cannot be
                used to identify anyone. Save the receipt number for your records.
              </p>
            </>
          ) : (
            <p className="mt-2 text-ink-2">The profile and all of its data have been removed.</p>
          )}
          <div className="mt-6">
            {fromClinician ? <ButtonLink href="/doctor" variant="primary">Back to patients</ButtonLink> : <ButtonLink href="/" variant="primary">Done</ButtonLink>}
          </div>
        </Card>
        <p className="mt-4 text-center text-[12px] text-ink-3">
          <Link href="/data-handling" className="hover:underline">How deletion works</Link>
        </p>
      </PageContainer>
    </>
  );
}
