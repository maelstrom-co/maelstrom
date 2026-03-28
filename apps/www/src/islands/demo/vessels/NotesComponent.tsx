import type { VesselComponentProps } from '@maelstrom-co/react-old';

export default function NotesComponent(_props: VesselComponentProps) {
  return (
    <div
      className="h-full overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, rgba(0, 255, 163, 0.1), rgba(0, 200, 255, 0.04))',
        borderRadius: '12px',
        border: '1px solid rgba(0, 255, 163, 0.15)',
      }}
    >
      {/* Top highlight */}
      <div className="absolute top-0 inset-x-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(0, 255, 163, 0.12), transparent)' }} />

      <div className="p-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] text-seafoam/80 font-mono tracking-wider uppercase">
            Notes
          </div>
          <div className="text-[9px] text-text-muted/25 font-mono">Mar 24</div>
        </div>

        <div className="text-[11px] text-text-muted/60 font-medium mb-2">Meeting Notes</div>

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
      </div>
    </div>
  );
}
