import type { BenchmarkSample } from './metrics';
import { compareBenchmarks, summarizeBenchmarks } from './metrics';

const sample = (overrides: Partial<BenchmarkSample> = {}): BenchmarkSample => ({
  mode: 'autonomous',
  complexity: 'moderate',
  outcome: 'verified_complete',
  durationMs: 5 * 60_000,
  firstPassTests: true,
  repairIterations: 0,
  manualInterventions: 0,
  ...overrides,
});

describe('summarizeBenchmarks', () => {
  it('returns null rates for an empty set instead of dividing by zero', () => {
    const summary = summarizeBenchmarks([]);

    expect(summary.samples).toBe(0);
    expect(summary.verifiedRate).toBeNull();
    expect(summary.firstPassTestRate).toBeNull();
    expect(summary.meanDurationMs).toBeNull();
    expect(summary.turboRate).toBeNull();
    expect(summary.meanRepairIterations).toBeNull();
  });

  it('aggregates completion, test, repair and latency metrics', () => {
    const summary = summarizeBenchmarks([
      sample({
        mode: 'turbo15',
        complexity: 'simple',
        durationMs: 10 * 60_000,
        repairIterations: 1,
        securityFindings: 2,
        modelLatencyMs: 500,
      }),
      sample({
        mode: 'turbo15',
        complexity: 'complex',
        outcome: 'complete_unverified',
        durationMs: 20 * 60_000,
        firstPassTests: false,
        repairIterations: 3,
        manualInterventions: 1,
        securityFindings: 0,
        modelLatencyMs: 700,
      }),
      sample({ modelLatencyMs: 300, securityFindings: 1 }),
    ]);

    expect(summary.samples).toBe(3);
    expect(summary.verifiedCompletions).toBe(2);
    expect(summary.verifiedRate).toBeCloseTo(2 / 3);
    expect(summary.firstPassTestRate).toBeCloseTo(2 / 3);
    expect(summary.meanDurationMs).toBeCloseTo(((10 + 20 + 5) / 3) * 60_000);
    expect(summary.meanRepairIterations).toBeCloseTo(4 / 3);
    expect(summary.totalManualInterventions).toBe(1);
    expect(summary.meanModelLatencyMs).toBe(500);
    expect(summary.meanSecurityFindings).toBe(1);
  });

  it('counts only a verified turbo run inside fifteen minutes as a turbo success', () => {
    const summary = summarizeBenchmarks([
      sample({ mode: 'turbo15', durationMs: 10 * 60_000 }),
      sample({ mode: 'turbo15', durationMs: 20 * 60_000 }),
      sample({ mode: 'turbo15', outcome: 'complete_unverified', durationMs: 5 * 60_000 }),
      sample({ mode: 'autonomous', durationMs: 2 * 60_000 }),
    ]);

    expect(summary.turboRuns).toBe(3);
    expect(summary.turboMet).toBe(1);
    expect(summary.turboRate).toBeCloseTo(1 / 3);
  });

  it('slices the same metrics by complexity and mode', () => {
    const summary = summarizeBenchmarks([
      sample({ complexity: 'simple' }),
      sample({ complexity: 'moderate', outcome: 'failed' }),
      sample({ mode: 'verified', outcome: 'failed' }),
    ]);

    expect(summary.byComplexity.simple.verifiedRate).toBe(1);
    expect(summary.byComplexity.moderate.verifiedRate).toBe(0);
    expect(summary.byComplexity.complex.samples).toBe(0);
    expect(summary.byMode.autonomous.verifiedRate).toBeCloseTo(1 / 2);
    expect(summary.byMode.verified.verifiedRate).toBe(0);
    expect(summary.byMode.turbo15.samples).toBe(0);
  });
});

describe('compareBenchmarks', () => {
  it('is incomparable without samples on both sides', () => {
    const empty = summarizeBenchmarks([]);
    const populated = summarizeBenchmarks([sample()]);

    expect(compareBenchmarks(empty, populated).verdict).toBe('incomparable');
    expect(compareBenchmarks(populated, empty).comparable).toBe(false);
  });

  it('reports an improvement when verified rate rises and duration falls', () => {
    const baseline = summarizeBenchmarks([
      sample({ outcome: 'failed', durationMs: 10 * 60_000 }),
      sample({ outcome: 'failed', durationMs: 10 * 60_000 }),
    ]);
    const candidate = summarizeBenchmarks([
      sample({ durationMs: 6 * 60_000 }),
      sample({ durationMs: 6 * 60_000 }),
    ]);

    const comparison = compareBenchmarks(baseline, candidate);
    expect(comparison.verdict).toBe('improved');
    expect(comparison.deltas.verifiedRate).toBe(1);
    expect(comparison.deltas.meanDurationMs).toBe(-4 * 60_000);
  });

  it('reports a regression when the candidate completes fewer builds', () => {
    const baseline = summarizeBenchmarks([sample(), sample()]);
    const candidate = summarizeBenchmarks([
      sample({ outcome: 'failed' }),
      sample({ outcome: 'failed' }),
    ]);

    const comparison = compareBenchmarks(baseline, candidate);
    expect(comparison.verdict).toBe('regressed');
    expect(comparison.reasons.some((reason) => reason.includes('Verified completion rate'))).toBe(
      true,
    );
  });

  it('reports mixed results instead of hiding a regression behind an improvement', () => {
    const baseline = summarizeBenchmarks([sample({ outcome: 'failed', durationMs: 5 * 60_000 })]);
    const candidate = summarizeBenchmarks([
      sample({ outcome: 'verified_complete', durationMs: 20 * 60_000 }),
    ]);

    expect(compareBenchmarks(baseline, candidate).verdict).toBe('mixed');
  });

  it('does not call a build improved when manual interventions rise', () => {
    const baseline = summarizeBenchmarks([sample({ durationMs: 300_000, manualInterventions: 0 })]);
    const candidate = summarizeBenchmarks([
      sample({ durationMs: 240_000, manualInterventions: 5 }),
    ]);

    const comparison = compareBenchmarks(baseline, candidate);
    expect(comparison.verdict).toBe('mixed');
    expect(comparison.deltas.meanManualInterventions).toBe(5);
  });

  it('normalizes interventions when the sample counts differ', () => {
    const baseline = summarizeBenchmarks([
      sample({ manualInterventions: 2 }),
      sample({ manualInterventions: 0 }),
    ]);
    const candidate = summarizeBenchmarks([sample({ manualInterventions: 2 })]);

    const comparison = compareBenchmarks(baseline, candidate);
    expect(comparison.deltas.meanManualInterventions).toBe(1);
    expect(comparison.verdict).toBe('regressed');
  });

  it('treats extra findings and latency as regressions', () => {
    const baseline = summarizeBenchmarks([sample({ securityFindings: 0, modelLatencyMs: 200 })]);
    const candidate = summarizeBenchmarks([sample({ securityFindings: 4, modelLatencyMs: 900 })]);

    expect(compareBenchmarks(baseline, candidate).verdict).toBe('regressed');
  });

  it('reports unchanged when no measured metric moves', () => {
    const baseline = summarizeBenchmarks([sample()]);
    const candidate = summarizeBenchmarks([sample()]);

    expect(compareBenchmarks(baseline, candidate).verdict).toBe('unchanged');
  });
});
