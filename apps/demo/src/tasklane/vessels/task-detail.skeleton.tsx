import { VesselCard } from '../../components/vessel-card';

export function TaskDetailSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="brand-3" label="Task" meta="Loading...">
      <div className="flex-1 space-y-3 animate-pulse">
        <div className="h-6 w-2/3 bg-white/5 rounded" />
        <div className="h-16 bg-white/5 rounded" />
        <div className="h-10 bg-white/5 rounded" />
      </div>
    </VesselCard>
  );
}
