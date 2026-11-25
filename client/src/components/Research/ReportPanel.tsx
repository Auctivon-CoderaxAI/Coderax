import { useMemo, useState } from 'react';
import { Button } from '@coderax/client';
import { Copy, Download } from 'lucide-react';
import { renderResearchReport } from 'coderax-data-provider';
import type { TResearchProject } from 'coderax-data-provider';
import { useLocalize } from '~/hooks';

const fileSlug = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'research-dossier'}.md`;
};

export default function ReportPanel({ project }: { project: TResearchProject }) {
  const localize = useLocalize();
  const [copied, setCopied] = useState(false);
  const report = useMemo(
    () =>
      renderResearchReport({
        title: project.title,
        question: project.question,
        status: project.status,
        sources: project.sources,
        claims: project.claims,
      }),
    [project.title, project.question, project.status, project.sources, project.claims],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileSlug(project.title);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      className="border-border-light bg-surface-secondary rounded-2xl border p-5"
      aria-labelledby="research-report-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="research-report-title" className="text-text-primary text-sm font-semibold">
            {localize('com_research_report_title')}
          </h2>
          <p className="text-text-secondary mt-1 max-w-2xl text-sm leading-6">
            {localize('com_research_report_subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={copy}>
            <Copy className="size-4" aria-hidden="true" />
            {localize('com_research_report_copy')}
          </Button>
          <Button type="button" variant="outline" onClick={download}>
            <Download className="size-4" aria-hidden="true" />
            {localize('com_research_report_download')}
          </Button>
        </div>
      </div>
      <p className="text-text-tertiary mt-2 min-h-5 text-xs" role="status" aria-live="polite">
        {copied ? localize('com_research_report_copied') : ''}
      </p>
      <pre
        className="border-border-light bg-surface-primary text-text-secondary mt-2 max-h-[28rem] overflow-auto rounded-xl border p-4 text-xs leading-6 whitespace-pre-wrap"
        aria-label={localize('com_research_report_preview_label')}
      >
        {report}
      </pre>
    </section>
  );
}
