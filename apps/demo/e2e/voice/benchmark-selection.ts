export const voiceBenchmarkScenarios = [
  'only-tasks',
  'open-calendar',
  'put-it-back',
] as const;

export type VoiceBenchmarkScenario = (typeof voiceBenchmarkScenarios)[number];

export interface VoiceBenchmarkSelection {
  readonly singleTurn: boolean;
  readonly repetitions: number;
  readonly scenarios: readonly VoiceBenchmarkScenario[];
  readonly selectedScenario: VoiceBenchmarkScenario | null;
}

export function singleTurnDiagnosticRetries(
  singleTurn: string | undefined,
): number {
  return singleTurn === '1' ? 3 : 0;
}

export function selectVoiceBenchmark(options: {
  readonly singleTurn?: string;
  readonly repetitions?: string;
}): VoiceBenchmarkSelection {
  const singleTurn = options.singleTurn ?? '';
  if (singleTurn !== '' && singleTurn !== '1')
    throw new Error(
      'VOICE_BENCHMARK_SINGLE_TURN must be set to 1 when enabled.',
    );

  const repetitions = options.repetitions ?? '1';
  if (!/^[1-3]$/.test(repetitions))
    throw new Error(
      'VOICE_BENCHMARK_REPETITIONS must be an integer from 1 to 3.',
    );

  if (singleTurn === '1') {
    const selectedScenario: VoiceBenchmarkScenario = 'only-tasks';
    return {
      singleTurn: true,
      repetitions: 1,
      scenarios: [selectedScenario],
      selectedScenario,
    };
  }

  return {
    singleTurn: false,
    repetitions: Number(repetitions),
    scenarios: voiceBenchmarkScenarios,
    selectedScenario: null,
  };
}
