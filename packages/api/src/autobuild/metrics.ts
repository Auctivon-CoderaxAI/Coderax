import type { BuildComplexity, BuildMode } from './modes';
import type { BuildOutcome } from './report';
import { TURBO_15_BUDGET_MS } from './modes';

/** One measured build. Durations and counts come from the run, not from a claim. */
export interface BenchmarkSample {
  mode: BuildMode;
  complexity: BuildComplexity;
  outcome: BuildOutcome;
  durationMs: number | null;
  firstPassTests: boolean;
  repairIterations: number;
  manualInterventions: number;
  securityFindings?: number;
  modelLatencyMs?: number;
}

export interface BenchmarkSlice {
  samples: number;
  verifiedCompletions: number;
  verifiedRate: number | null;
  firstPassTestRate: number | null;
  meanDurationMs: number | null;
  meanRepairIterations: number | null;
  turboRuns: number;
  turboMet: number;
  turboRate: number | null;
  meanSecurityFindings: number | null;
}

export interface BenchmarkSummary extends BenchmarkSlice {
  totalManualInterventions: number;
  meanModelLatencyMs: number | null;
  byComplexity: Record<BuildComplexity, BenchmarkSlice>;
  byMode: Record<BuildMode, BenchmarkSlice>;
}

const COMPLEXITIES: readonly BuildComplexity[] = ['simple', 'moderate', 'complex'];
const MODES: readonly BuildMode[] = ['turbo15', 'autonomous', 'verified'];

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

/** Normalize a total by sample count before comparing sets of different sizes. */
function interventionsPerSample(samples: number, interventions: number): number | null {
  return samples === 0 ? null : interventions / samples;
}

function isVerified(sample: BenchmarkSample): boolean {
  return sample.outcome === 'verified_complete';
}

/**
 * A 15-minute MVP is a verified result inside the budget. A fast unverified run
 * is not a turbo success.
 */
function isTurboMet(sample: BenchmarkSample): boolean {
  return (
    sample.mode === 'turbo15' &&
    isVerified(sample) &&
    sample.durationMs != null &&
    sample.durationMs <= TURBO_15_BUDGET_MS
  );
}

function summarizeSlice(samples: BenchmarkSample[]): BenchmarkSlice {
  const verifiedCompletions = samples.filter(isVerified).length;
  const turbo = samples.filter((sample) => sample.mode === 'turbo15');
  const turboMet = turbo.filter(isTurboMet).length;
  const firstPass = samples.filter((sample) => sample.firstPassTests).length;
  const securityFindings = samples
    .map((sample) => sample.securityFindings)
    .filter((value): value is number => value != null);
  const durations = samples
    .map((sample) => sample.durationMs)
    .filter((value): value is number => value != null);

  return {
    samples: samples.length,
    verifiedCompletions,
    verifiedRate: rate(verifiedCompletions, samples.length),
    firstPassTestRate: rate(firstPass, samples.length),
    meanDurationMs: mean(durations),
    meanRepairIterations: mean(samples.map((sample) => sample.repairIterations)),
    turboRuns: turbo.length,
    turboMet,
    turboRate: rate(turboMet, turbo.length),
    meanSecurityFindings: mean(securityFindings),
  };
}

/** Aggregate the benchmark dimensions the build engine is judged on. */
export function summarizeBenchmarks(samples: readonly BenchmarkSample[]): BenchmarkSummary {
  const list = [...samples];
  const base = summarizeSlice(list);
  const latencies = list
    .map((sample) => sample.modelLatencyMs)
    .filter((value): value is number => value != null);

  const byComplexity = Object.fromEntries(
    COMPLEXITIES.map((complexity) => [
      complexity,
      summarizeSlice(list.filter((sample) => sample.complexity === complexity)),
    ]),
  ) as Record<BuildComplexity, BenchmarkSlice>;

  const byMode = Object.fromEntries(
    MODES.map((mode) => [mode, summarizeSlice(list.filter((sample) => sample.mode === mode))]),
  ) as Record<BuildMode, BenchmarkSlice>;

  return {
    ...base,
    totalManualInterventions: list.reduce((total, sample) => total + sample.manualInterventions, 0),
    meanModelLatencyMs: mean(latencies),
    byComplexity,
    byMode,
  };
}

export interface BenchmarkComparison {
  comparable: boolean;
  verdict: 'improved' | 'regressed' | 'mixed' | 'unchanged' | 'incomparable';
  deltas: {
    verifiedRate: number | null;
    firstPassTestRate: number | null;
    meanDurationMs: number | null;
    turboRate: number | null;
    meanRepairIterations: number | null;
    meanManualInterventions: number | null;
    meanSecurityFindings: number | null;
    meanModelLatencyMs: number | null;
  };
  reasons: string[];
}

function delta(candidate: number | null, baseline: number | null): number | null {
  return candidate == null || baseline == null ? null : candidate - baseline;
}

/**
 * Compare a candidate engine with a baseline on the metrics that can move in
 * both directions. A one-off improvement does not hide a regression elsewhere.
 */
export function compareBenchmarks(
  baseline: BenchmarkSummary,
  candidate: BenchmarkSummary,
): BenchmarkComparison {
  const empty = baseline.samples === 0 || candidate.samples === 0;
  const differentMix = COMPLEXITIES.some(
    (complexity) =>
      baseline.byComplexity[complexity].samples * candidate.samples !==
      candidate.byComplexity[complexity].samples * baseline.samples,
  );
  if (empty || differentMix) {
    return {
      comparable: false,
      verdict: 'incomparable',
      deltas: {
        verifiedRate: null,
        firstPassTestRate: null,
        meanDurationMs: null,
        turboRate: null,
        meanRepairIterations: null,
        meanManualInterventions: null,
        meanSecurityFindings: null,
        meanModelLatencyMs: null,
      },
      reasons: [
        empty
          ? 'Both benchmark sets need at least one sample.'
          : 'Benchmark sets have different complexity distributions. Compare matching slices.',
      ],
    };
  }

  const deltas = {
    verifiedRate: delta(candidate.verifiedRate, baseline.verifiedRate),
    firstPassTestRate: delta(candidate.firstPassTestRate, baseline.firstPassTestRate),
    meanDurationMs: delta(candidate.meanDurationMs, baseline.meanDurationMs),
    turboRate: delta(candidate.turboRate, baseline.turboRate),
    meanRepairIterations: delta(candidate.meanRepairIterations, baseline.meanRepairIterations),
    meanManualInterventions: delta(
      interventionsPerSample(candidate.samples, candidate.totalManualInterventions),
      interventionsPerSample(baseline.samples, baseline.totalManualInterventions),
    ),
    meanSecurityFindings: delta(candidate.meanSecurityFindings, baseline.meanSecurityFindings),
    meanModelLatencyMs: delta(candidate.meanModelLatencyMs, baseline.meanModelLatencyMs),
  };

  const reasons: string[] = [];
  let improved = false;
  let regressed = false;

  const record = (
    label: string,
    value: number | null,
    higherIsBetter: boolean,
    format: (entry: number) => string,
  ): void => {
    if (value == null) {
      reasons.push(`${label}: not comparable`);
      return;
    }
    const better = higherIsBetter ? value > 0 : value < 0;
    const worse = higherIsBetter ? value < 0 : value > 0;
    improved = improved || better;
    regressed = regressed || worse;
    reasons.push(`${label}: ${format(value)}`);
  };

  record(
    'Verified completion rate',
    deltas.verifiedRate,
    true,
    (value) => `${(value * 100).toFixed(1)} pp`,
  );
  record(
    'First-pass test rate',
    deltas.firstPassTestRate,
    true,
    (value) => `${(value * 100).toFixed(1)} pp`,
  );
  record('Mean duration', deltas.meanDurationMs, false, (value) => `${value.toFixed(0)} ms`);
  record('Turbo success rate', deltas.turboRate, true, (value) => `${(value * 100).toFixed(1)} pp`);
  record('Mean repair iterations', deltas.meanRepairIterations, false, (value) => value.toFixed(2));
  record('Mean manual interventions', deltas.meanManualInterventions, false, (value) =>
    value.toFixed(2),
  );
  record('Mean security findings', deltas.meanSecurityFindings, false, (value) => value.toFixed(2));
  record(
    'Mean model latency',
    deltas.meanModelLatencyMs,
    false,
    (value) => `${value.toFixed(0)} ms`,
  );

  let verdict: BenchmarkComparison['verdict'] = 'unchanged';
  if (improved && regressed) {
    verdict = 'mixed';
  } else if (improved) {
    verdict = 'improved';
  } else if (regressed) {
    verdict = 'regressed';
  }

  return { comparable: true, verdict, deltas, reasons };
}
