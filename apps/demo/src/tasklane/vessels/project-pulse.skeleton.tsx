import { VesselCard } from '../../components/vessel-card';

export function ProjectPulseSkeleton(_props: { vesselId: string }) {
  return (
    <VesselCard accent="green" label="Pulse">
      <div className="flex-1 grid grid-cols-2 gap-2 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-white/5 rounded" />
        ))}
      </div>
    </VesselCard>
  );
}
