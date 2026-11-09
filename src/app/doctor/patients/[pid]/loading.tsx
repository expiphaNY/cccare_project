export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-36 rounded-card bg-white" />
        <div className="h-36 rounded-card bg-white" />
      </div>
      <div className="h-80 rounded-card bg-white" />
    </div>
  );
}
