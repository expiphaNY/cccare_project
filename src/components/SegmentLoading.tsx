export default function SegmentLoading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-28 rounded-card bg-white" />
      <div className="h-80 rounded-card bg-white" />
    </div>
  );
}
