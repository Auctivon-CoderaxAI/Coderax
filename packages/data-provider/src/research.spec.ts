import {
  auditResearch,
  effectiveClaimStatus,
  renderResearchReport,
  researchUrlHost,
  type TResearchClaim,
  type TResearchSource,
} from './research';

const source = (overrides: Partial<TResearchSource> = {}): TResearchSource => ({
  id: 'source-1',
  title: 'Primary filing',
  url: 'https://example.com/filing',
  publisher: 'Example',
  kind: 'primary',
  excerpt: 'The filing states the figure.',
  note: '',
  retrievedAt: '2026-11-20',
  ...overrides,
});

const claim = (overrides: Partial<TResearchClaim> = {}): TResearchClaim => ({
  id: 'claim-1',
  text: 'The figure is 42.',
  status: 'supported',
  sourceIds: ['source-1'],
  ...overrides,
});

describe('researchUrlHost', () => {
  it('accepts http and https and strips www', () => {
    expect(researchUrlHost('https://www.example.com/a')).toBe('example.com');
    expect(researchUrlHost('http://docs.example.org')).toBe('docs.example.org');
  });

  it('rejects other schemes and malformed values', () => {
    expect(researchUrlHost('javascript:alert(1)')).toBeNull();
    expect(researchUrlHost('not a url')).toBeNull();
  });
});

describe('effectiveClaimStatus', () => {
  it('downgrades a supported claim that cites only unknown sources', () => {
    const known = new Set(['source-1']);
    expect(effectiveClaimStatus(claim({ sourceIds: ['missing'] }), known)).toBe('unsupported');
    expect(effectiveClaimStatus(claim(), known)).toBe('supported');
  });
});

describe('auditResearch', () => {
  it('counts evidence and marks a fully cited ledger ready', () => {
    const audit = auditResearch({
      sources: [
        source(),
        source({
          id: 'source-2',
          title: 'Secondary report',
          kind: 'secondary',
          url: 'https://news.example.org/report',
        }),
      ],
      claims: [
        claim({ sourceIds: ['source-1', 'source-2'] }),
        claim({ id: 'claim-2', text: 'A second reading.', status: 'uncertain' }),
      ],
    });

    expect(audit.sources).toBe(2);
    expect(audit.claims).toBe(2);
    expect(audit.distinctDomains).toBe(2);
    expect(audit.primarySources).toBe(1);
    expect(audit.effective).toEqual({
      supported: 1,
      contradicted: 0,
      uncertain: 1,
      unsupported: 0,
    });
    expect(audit.issues).toEqual([]);
    expect(audit.ready).toBe(true);
  });

  it('reports an uncited claim as unsupported and blocks completion', () => {
    const audit = auditResearch({
      sources: [source()],
      claims: [claim({ sourceIds: [] })],
    });

    expect(audit.effective.unsupported).toBe(1);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CLAIM_WITHOUT_SOURCE',
          severity: 'error',
          claimId: 'claim-1',
        }),
        expect.objectContaining({
          code: 'SOURCE_UNUSED',
          severity: 'warning',
          sourceId: 'source-1',
        }),
      ]),
    );
    expect(audit.ready).toBe(false);
  });

  it('keeps unknown citations, unused sources, duplicates and contradictions visible', () => {
    const audit = auditResearch({
      sources: [source(), source({ id: 'source-2' })],
      claims: [claim({ sourceIds: ['source-1', 'gone'], status: 'contradicted' })],
    });

    expect(audit.unknownCitationClaimIds).toEqual(['claim-1']);
    expect(audit.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'CITATION_UNKNOWN_SOURCE',
        'CONTRADICTED_CLAIM',
        'SOURCE_UNUSED',
        'DUPLICATE_SOURCE_URL',
      ]),
    );
    expect(audit.ready).toBe(false);
  });

  it('requires both a source and a claim before completion', () => {
    expect(auditResearch({ sources: [], claims: [] }).ready).toBe(false);
    expect(auditResearch({ sources: [source()], claims: [] }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'NO_CLAIMS' })]),
    );
  });
});

describe('renderResearchReport', () => {
  it('renders numbered sources, resolved citations and the limitation', () => {
    const report = renderResearchReport({
      title: 'Free tool calling',
      question: 'Which providers still support it?',
      status: 'review',
      sources: [
        source(),
        source({ id: 'source-2', title: 'Second source', url: 'https://example.com/2' }),
      ],
      claims: [
        claim({ sourceIds: ['source-2', 'source-1'] }),
        claim({ id: 'claim-2', text: 'Unclear.', status: 'uncertain', sourceIds: [] }),
      ],
    });

    expect(report).toContain('# Free tool calling');
    expect(report).toContain('**Question:** Which providers still support it?');
    expect(report).toContain('**Status:** In review');
    expect(report).toContain('- **Supported** — The figure is 42. [1][2]');
    expect(report).toContain('- **Unsupported** — Unclear.');
    expect(report).toContain('1. [Primary filing](https://example.com/filing)');
    expect(report).toContain('## Verification');
    expect(report).toContain('## Limitations');
    expect(report).toContain('has not fetched, summarised or independently verified');
  });

  it('never renders a citation for an unknown source', () => {
    const report = renderResearchReport({
      title: 'Missing source',
      question: '',
      status: 'collecting',
      sources: [source()],
      claims: [claim({ sourceIds: ['gone'] })],
    });

    expect(report).toContain('- **Unsupported** — The figure is 42.');
    expect(report).not.toContain('[1] — The figure');
    expect(report).not.toContain('(undefined)');
  });
});
