import { SearchX } from "lucide-react";
import { Logo } from "@/components/nav";
import { ButtonLink, Card, PageContainer } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <header className="mx-auto flex h-16 w-full max-w-3xl items-center px-4 sm:px-6">
        <Logo />
      </header>
      <PageContainer className="max-w-md pt-16">
        <Card className="p-8 text-center">
          <SearchX className="mx-auto size-8 text-ink-3" aria-hidden />
          <h1 className="title mt-4 text-xl font-semibold">Nothing here</h1>
          <p className="mt-2 text-sm text-ink-2">This page or profile doesn’t exist — it may have been deleted.</p>
          <div className="mt-6 flex justify-center gap-2">
            <ButtonLink href="/" variant="primary">Home</ButtonLink>
            <ButtonLink href="/doctor">Patients</ButtonLink>
          </div>
        </Card>
      </PageContainer>
    </>
  );
}
