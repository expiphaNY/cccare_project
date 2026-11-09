import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Logo } from "@/components/nav";
import { DataFlow, SignalExplainer } from "@/components/transparency";
import { Card, PageContainer } from "@/components/ui";

export const metadata = { title: "How we handle data" };

const STANDARDS = [
  {
    name: "HL7 FHIR R4",
    use: "Used for: sharing the full profile with another clinic",
    body: "The JSON export is a FHIR Bundle with Patient, Encounter (one per session), Observation (one per exercise set, with metrics and the envelope waveform as SampledData), Device, Consent and Provenance. Most modern clinic systems can import FHIR.",
    href: "https://hl7.org/fhir/R4/observation-example-sample-data.html",
  },
  {
    name: "FHIR waveform profiles",
    use: "Used for: how the waveform is packed",
    body: "SampledData follows HL7’s device-waveform guidance (Personal Health Device IG, Point-of-Care Device IG). No EMG-specific FHIR profile exists yet, so EMG metrics use a declared local code system pending terminology review.",
    href: "https://www.hl7.org/fhir/uv/phd/en/StructureDefinition-PhdRtsaObservation.html",
  },
  {
    name: "DICOM Electromyogram Waveform",
    use: "Planned: archiving raw EMG in imaging systems",
    body: "DICOM Supplement 217 added an Electromyogram IOD and storage class for raw EMG. Useful when a hospital wants raw signals stored in its PACS next to other diagnostics.",
    href: "https://www.dicomstandard.org/news/supplements/view/neurophysiology-waveforms",
  },
  {
    name: "EDF / EDF+",
    use: "Planned: research exchange of raw signals",
    body: "The European Data Format is the de-facto file format for biosignals in research tools. Per-set CSV exports are available today.",
    href: "https://www.edfplus.info/",
  },
  {
    name: "FHIR Patient $everything",
    use: "Pattern: “give me the whole record”",
    body: "The full-profile export mirrors what $everything returns on a FHIR server, so a future FHIR API can expose the same operation.",
    href: "https://hl7.org/fhir/R4/patient-operation-everything.html",
  },
];

export default function DataHandling() {
  return (
    <>
      <header className="material sticky top-0 z-40 border-b border-line/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <Link href="/" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-brand">
            <ArrowLeft className="size-4" aria-hidden /> Back
          </Link>
        </div>
      </header>
      <PageContainer className="max-w-5xl space-y-10 pt-10">
        <div className="max-w-3xl">
          <p className="eyebrow !text-brand">Transparency</p>
          <h1 className="display mt-2 text-[40px] font-semibold">How MyoCare handles your data</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
            Written for patients first. If something here is unclear, that’s our problem to fix — ask your clinician.
          </p>
        </div>

        <section>
          <h2 className="title text-xl font-semibold">What is collected</h2>
          <p className="mt-1 text-sm text-ink-2">
            A small sensor measures the electrical activity of one muscle. For every set we store three versions of that signal, plus the exercise, set number,
            date and time. We also store your name, date of birth, condition and the notes your clinician writes.
          </p>
          <div className="mt-4">
            <SignalExplainer />
          </div>
          <p className="mt-3 text-sm text-ink-2">
            <b className="text-ink">Not collected:</b> location, audio, video, contacts, or anything from your phone.
          </p>
        </section>

        <section>
          <h2 className="title text-xl font-semibold">How it travels and where it lives</h2>
          <div className="mt-4">
            <DataFlow region="Encrypted MongoDB cluster · Canada (Central) region" />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {[
            ["Who can see it", "You, your assigned clinician, and — only if you allow it — others in your care team. Anyone else needs a share link that you or your clinician create."],
            ["Share links", "Each link names its recipient, expires (24 hours to 90 days), can be revoked instantly, and every opening is written to your access log. Raw signals are excluded unless explicitly included."],
            ["Access log", "Every view, export, share, consent change and new recording is logged with who, when and what. You see the exact same log your clinician sees."],
            ["Your choices", "Care-team access, sharing, and de-identified research use are switches you control. Research is off unless you turn it on."],
            ["Taking it with you", "Download everything as a PDF, a self-contained interactive HTML file, or a FHIR R4 bundle another clinic can import."],
            ["Deleting it", "Delete removes every session, signal, share link and log entry. We keep only a deletion receipt with no name or health data, so the deletion can be proven later. Legal record-keeping rules may require some clinics to retain records; we will tell you if that applies."],
          ].map(([t, d]) => (
            <Card key={t} className="p-5">
              <h3 className="text-[15px] font-semibold">{t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-2">{d}</p>
            </Card>
          ))}
        </section>

        <section>
          <h2 className="title text-xl font-semibold">Standards we follow for sharing</h2>
          <p className="mt-1 text-sm text-ink-2">So your record can move between clinics without retyping or lock-in.</p>
          <div className="mt-4 grid gap-3">
            {STANDARDS.map((s) => (
              <Card key={s.name} className="flex flex-wrap items-start gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h3 className="text-[15px] font-semibold">{s.name}</h3>
                    <span className="text-[12px] text-brand">{s.use}</span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{s.body}</p>
                </div>
                <a href={s.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                  Spec <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </Card>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-3">
            Privacy law depends on where you live (e.g. PHIPA/PIPEDA in Canada, HIPAA in the US, GDPR in the EU). The right of access, portability and
            correction is built in; specific retention periods must be confirmed by the deploying clinic.
          </p>
        </section>
      </PageContainer>
    </>
  );
}
