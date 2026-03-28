import { useState, useEffect, useRef, useCallback } from 'react';
import { ScrollArea } from './ScrollArea';

interface TranscriptLine {
  speaker: 'user' | 'system' | 'ambient';
  text: string;
  delay: number; // ms from start
}

interface UIState {
  label: string;
  panels: { name: string; color: string; span?: number }[];
}

const commandScript: TranscriptLine[] = [
  { speaker: 'user', text: '"Show me pending orders"', delay: 0 },
  { speaker: 'system', text: 'Filtering orders by status...', delay: 1200 },
  { speaker: 'system', text: 'Expanding orders panel to full view.', delay: 2200 },
  { speaker: 'user', text: '"Open the first one"', delay: 5000 },
  { speaker: 'system', text: 'Selecting order #1847. Showing details.', delay: 6200 },
];

const commandUIStates: { at: number; state: UIState }[] = [
  {
    at: 0,
    state: {
      label: 'Dashboard',
      panels: [
        { name: 'Orders', color: '#00f0ff' },
        { name: 'Revenue', color: '#0066ff' },
        { name: 'Alerts', color: '#6b00ff' },
        { name: 'Activity', color: '#00ffa3' },
      ],
    },
  },
  {
    at: 2200,
    state: {
      label: 'Filtered View',
      panels: [
        { name: 'Orders (Pending)', color: '#00f0ff', span: 2 },
        { name: 'Alerts', color: '#6b00ff' },
      ],
    },
  },
  {
    at: 6200,
    state: {
      label: 'Order Details',
      panels: [
        { name: 'Order #1847', color: '#00f0ff', span: 2 },
        { name: 'Timeline', color: '#0066ff' },
      ],
    },
  },
];

const ambientScript: TranscriptLine[] = [
  { speaker: 'ambient', text: 'Dr. Reyes: "How long have you had the chest pain?"', delay: 0 },
  { speaker: 'ambient', text: 'Patient: "About two weeks, mostly at night."', delay: 2000 },
  { speaker: 'system', text: 'Showing cardiac history + recent labs.', delay: 3200 },
  { speaker: 'ambient', text: 'Dr. Reyes: "Any family history of heart disease?"', delay: 5500 },
  { speaker: 'system', text: 'Pulling family medical history.', delay: 6700 },
  { speaker: 'ambient', text: 'Patient: "My father had a bypass at 55."', delay: 8500 },
  { speaker: 'system', text: 'Flagging hereditary risk factors.', delay: 9700 },
];

const ambientUIStates: { at: number; state: UIState }[] = [
  {
    at: 0,
    state: {
      label: 'Patient Visit',
      panels: [
        { name: 'Patient Info', color: '#00f0ff' },
        { name: 'Vitals', color: '#0066ff' },
        { name: 'Notes', color: '#00ffa3' },
        { name: 'Schedule', color: '#6b00ff' },
      ],
    },
  },
  {
    at: 3200,
    state: {
      label: 'Cardiac Context',
      panels: [
        { name: 'Cardiac History', color: '#00f0ff', span: 2 },
        { name: 'Recent Labs', color: '#0066ff' },
        { name: 'Vitals', color: '#00ffa3' },
      ],
    },
  },
  {
    at: 6700,
    state: {
      label: 'Family History',
      panels: [
        { name: 'Family History', color: '#6b00ff', span: 2 },
        { name: 'Cardiac History', color: '#00f0ff' },
        { name: 'Risk Factors', color: '#ff4444' },
      ],
    },
  },
];

function VoiceDemo({
  title,
  description,
  script,
  uiStates,
  icon,
}: {
  title: string;
  description: string;
  script: TranscriptLine[];
  uiStates: { at: number; state: UIState }[];
  icon: React.ReactNode;
}) {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [currentUI, setCurrentUI] = useState<UIState>(uiStates[0].state);
  const isRunningRef = useRef(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const cleanup = useCallback(() => {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
  }, []);

  const runDemo = useCallback(() => {
    cleanup();
    setVisibleLines(0);
    setCurrentUI(uiStates[0].state);
    isRunningRef.current = true;

    for (let i = 0; i < script.length; i++) {
      const t = setTimeout(() => setVisibleLines(i + 1), script[i].delay);
      timeoutsRef.current.push(t);
    }

    for (const us of uiStates) {
      const t = setTimeout(() => setCurrentUI(us.state), us.at);
      timeoutsRef.current.push(t);
    }

    const totalDuration = script[script.length - 1].delay + 4000;
    const restartTimeout = setTimeout(() => {
      isRunningRef.current = false;
      runDemo();
    }, totalDuration);
    timeoutsRef.current.push(restartTimeout);
  }, [script, uiStates, cleanup]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isRunningRef.current) {
          runDemo();
        }
      },
      { threshold: 0.3 },
    );

    if (containerRef.current) observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      cleanup();
    };
  }, [runDemo, cleanup]);

  return (
    <div ref={containerRef} className="flex-1 min-w-0">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-cyan shadow-[0_0_20px_rgba(0,240,255,0.05)]">
          {icon}
        </div>
        <div>
          <h3 className="font-display font-bold text-text text-lg">{title}</h3>
          <p className="text-text-muted/70 text-sm">{description}</p>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(10, 30, 53, 0.4)', border: '1px solid rgba(255, 255, 255, 0.06)', boxShadow: '0 8px 40px rgba(0, 0, 0, 0.25), 0 0 40px rgba(0, 240, 255, 0.02)' }}>
        {/* Mini UI preview */}
        <div className="p-4 border-b border-white/[0.04]">
          <div className="text-[10px] font-mono text-text-muted/50 mb-3 tracking-wider uppercase" style={{ minHeight: '15px' }}>
            {currentUI.label}
          </div>
          <div className="grid grid-cols-4 gap-2" style={{ height: '68px' }}>
            {currentUI.panels.map((panel, i) => (
              <div
                key={`${panel.name}-${i}`}
                className="rounded-lg p-2 transition-all duration-700 ease-in-out"
                style={{
                  background: `${panel.color}08`,
                  borderLeft: `2px solid ${panel.color}30`,
                  gridColumn: panel.span ? `span ${panel.span}` : undefined,
                }}
              >
                <div
                  className="text-[9px] font-mono truncate"
                  style={{ color: `${panel.color}aa` }}
                >
                  {panel.name}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Transcript — fixed height to prevent layout shifts */}
        <ScrollArea className="h-[200px]">
        <div className="p-4 space-y-2.5" aria-live="polite" aria-atomic="false">
          {script.slice(0, visibleLines).map((line, i) => (
            <div
              key={i}
              className="flex gap-2.5 items-start animate-fade-in"
            >
              <div
                className={`text-[10px] font-mono mt-0.5 shrink-0 ${
                  line.speaker === 'system'
                    ? 'text-cyan/60'
                    : line.speaker === 'ambient'
                      ? 'text-violet/60'
                      : 'text-text-muted/40'
                }`}
              >
                {line.speaker === 'system'
                  ? 'AI'
                  : line.speaker === 'ambient'
                    ? '🎙'
                    : '→'}
              </div>
              <p
                className={`text-xs leading-relaxed ${
                  line.speaker === 'system'
                    ? 'text-cyan/80 font-mono'
                    : line.speaker === 'ambient'
                      ? 'text-text-muted/70 italic'
                      : 'text-text/80'
                }`}
              >
                {line.text}
              </p>
            </div>
          ))}
        </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default function VoiceShowcase() {
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <VoiceDemo
        title="Command Mode"
        description="Talk to your interface directly"
        script={commandScript}
        uiStates={commandUIStates}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
        }
      />
      <VoiceDemo
        title="Ambient Mode"
        description="The UI listens and adapts to context"
        script={ambientScript}
        uiStates={ambientUIStates}
        icon={
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
      />
    </div>
  );
}
