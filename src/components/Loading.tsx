import { PageContainer } from "./ui";

export function PageSkeleton() {
  return (
    <PageContainer className="pt-8" >
      <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
        <div className="h-4 w-48 rounded-full bg-line" />
        <div className="h-9 w-80 rounded-xl bg-line" />
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-card bg-white" />
          ))}
        </div>
        <div className="h-80 rounded-card bg-white" />
      </div>
    </PageContainer>
  );
}
