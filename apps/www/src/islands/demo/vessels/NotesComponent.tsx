import type { TypedVesselProps } from '@maelstrom-co/react';

import type { notesVessel } from './notes.vessel';
import VesselCard from './VesselCard';

export default function NotesComponent(
  _props: TypedVesselProps<typeof notesVessel>,
) {
  return (
    <VesselCard accent="#00ffa3" label="Notes" meta="Mar 24">
      <div className="text-[11px] text-text-muted/60 font-medium mb-2">
        Meeting Notes
      </div>

      {/* Simulated text lines with realistic widths */}
      <div className="space-y-[6px] flex-1">
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full bg-seafoam/30 shrink-0" />
          <div className="h-[2px] w-[78%] rounded-full bg-white/[0.07]" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full shrink-0" />
          <div className="h-[2px] w-[92%] rounded-full bg-white/[0.05]" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full bg-seafoam/30 shrink-0" />
          <div className="h-[2px] w-[65%] rounded-full bg-white/[0.07]" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full shrink-0" />
          <div className="h-[2px] w-[88%] rounded-full bg-white/[0.05]" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1 h-1 rounded-full shrink-0" />
          <div className="h-[2px] w-[45%] rounded-full bg-white/[0.05]" />
        </div>
      </div>
    </VesselCard>
  );
}
