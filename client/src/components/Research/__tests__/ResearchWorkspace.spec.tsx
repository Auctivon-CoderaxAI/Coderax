import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type * as ReactModule from 'react';
import type { ReactNode } from 'react';
import ResearchWorkspace from '../ResearchWorkspace';

jest.mock('~/data-provider', () => {
  const { auditResearch } = jest.requireActual('coderax-data-provider');
  const sources = [
    {
      id: 'source-1',
      title: 'Primary filing',
      url: 'https://example.com/filing',
      publisher: 'Example',
      kind: 'primary',
      excerpt: '',
      note: '',
      retrievedAt: '2026-11-20',
    },
  ];
  const claims = [
    {
      id: 'claim-1',
      text: 'The figure is 42.',
      status: 'supported',
      sourceIds: [],
    },
  ];
  const dossier = {
    _id: 'research-1',
    title: 'Free tool calling',
    question: 'Which providers still support it?',
    status: 'collecting',
    revision: 3,
    sources,
    claims,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    audit: auditResearch({ sources, claims }),
  };
  return {
    useResearchProjectQuery: () => ({
      data: dossier,
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    }),
    useSaveResearchProjectMutation: () => ({ mutate: jest.fn(), isLoading: false, error: null }),
    useDeleteResearchProjectMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@coderax/client', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) =>
      React.createElement('button', props, children),
    Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => React.createElement('div', props),
  };
});

const renderWorkspace = () =>
  render(
    <MemoryRouter initialEntries={['/research/research-1']}>
      <Routes>
        <Route path="/research/:researchId" element={<ResearchWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ResearchWorkspace', () => {
  it('reports an uncited claim as unsupported and shows the blocking issue', () => {
    renderWorkspace();

    expect(screen.getByText('com_research_effective_unsupported')).toBeInTheDocument();
    expect(screen.getByText(/com_research_claim_uncited/)).toBeInTheDocument();
    expect(screen.getByText('com_research_issue_claim_without_source')).toBeInTheDocument();
    expect(screen.getByText('com_research_audit_blocked')).toBeInTheDocument();
  });

  it('keeps source and claim entry available while the dossier is open', () => {
    renderWorkspace();

    expect(
      screen.getByRole('heading', { name: 'com_research_source_add_title' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'com_research_claim_add_title' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('com_research_status_label')).toBeEnabled();
  });

  it('renders a readable report with the recorded source', () => {
    renderWorkspace();

    const preview = screen.getByLabelText('com_research_report_preview_label');
    expect(preview.textContent).toContain('Primary filing');
    expect(preview.textContent).toContain('Unsupported');
    expect(preview.textContent).toContain('Limitations');
  });
});
