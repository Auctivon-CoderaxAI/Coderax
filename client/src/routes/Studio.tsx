import { useEffect, useMemo, useState } from 'react';
import {
  generateStudioProject,
  MAX_HTML_LENGTH,
  MAX_PROMPT_LENGTH,
  STUDIO_PREVIEW_CSP,
  type StudioProject,
} from '~/lib/studio/templates';

const STORAGE_KEY = 'coderax-studio-v1';

function readProject(): StudioProject {
  const fallback = generateStudioProject('Create a modern landing page for a useful new product');
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const candidate: unknown = JSON.parse(stored);
    if (!candidate || typeof candidate !== 'object') return fallback;
    const value = candidate as Partial<StudioProject>;
    if (
      typeof value.prompt !== 'string' ||
      typeof value.title !== 'string' ||
      typeof value.html !== 'string' ||
      !['landing', 'dashboard', 'store', 'booking'].includes(String(value.kind)) ||
      value.prompt.length > MAX_PROMPT_LENGTH ||
      value.html.length > MAX_HTML_LENGTH
    ) return fallback;
    return value as StudioProject;
  } catch {
    return fallback;
  }
}

function safePreview(html: string): string {
  // Ordinary scaffolds have <head>, so insert CSP before styles and resources.
  // Even with user-edited invalid HTML, sandbox="" disables active scripts,
  // forms, top-level navigation and same-origin access.
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + STUDIO_PREVIEW_CSP);
  }
  return STUDIO_PREVIEW_CSP + html;
}

function downloadHtml(content: string): void {
  const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'coderax-studio.html';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Studio() {
  const [project, setProject] = useState<StudioProject>(readProject);
  const [draft, setDraft] = useState(project.prompt);
  const [previous, setPrevious] = useState<StudioProject | null>(null);
  const [view, setView] = useState<'split' | 'preview' | 'code'>('split');
  const [status, setStatus] = useState('');
  const preview = useMemo(() => safePreview(project.html), [project.html]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      setStatus('Browser storage unavailable. Export your HTML to keep it.');
    }
  }, [project]);

  const create = () => {
    setPrevious(project);
    setProject(generateStudioProject(draft));
    setStatus('Local starter template created. Edit the HTML to customize.');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(project.html);
      setStatus('HTML copied to clipboard.');
    } catch {
      setStatus('Clipboard access denied. Select and copy the HTML in the editor.');
    }
  };

  const restore = () => {
    if (!previous) return;
    setProject(previous);
    setDraft(previous.prompt);
    setPrevious(null);
    setStatus('Previous version restored.');
  };

  return (
    <main className="min-h-screen w-full bg-slate-50 px-4 py-7 text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:px-8">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-300">
              Coderax / Studio
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Visual App Studio</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              A free, local-first starter builder. AI generation, GitHub commits and deployment are not connected yet.
            </p>
          </div>
          <a
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
            href="/c/new"
          >
            Return to chat
          </a>
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <label className="mb-2 block text-sm font-semibold" htmlFor="studio-prompt">
            Describe your app
          </label>
          <textarea
            id="studio-prompt"
            rows={3}
            maxLength={MAX_PROMPT_LENGTH}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="A dashboard for a fitness studio with useful metrics…"
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-offset-2 focus:outline-indigo-600 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
              onClick={create}
              type="button"
            >
              Generate starter layout
            </button>
            <button
              type="button"
              onClick={restore}
              disabled={!previous}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
            >
              Undo generation
            </button>
            <span className="ml-auto text-xs text-slate-500">
              {draft.length}/{MAX_PROMPT_LENGTH} characters
            </span>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            This MVP uses deterministic templates, not an AI model. Generated pages contain sample data and do not perform real transactions.
            Browser-local project storage is not intended for sensitive information.
          </p>
        </section>
        <div className="my-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2" aria-label="Editor layout">
            {(['split', 'preview', 'code'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                aria-pressed={view === choice}
                onClick={() => setView(choice)}
                className={
                  'rounded-xl px-4 py-2 text-sm font-semibold capitalize ' +
                  (view === choice
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900')
                }
              >
                {choice}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-slate-700"
            >
              Copy HTML
            </button>
            <button
              type="button"
              onClick={() => downloadHtml(project.html)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Download HTML
            </button>
          </div>
        </div>
        {status && <p role="status" className="mb-3 text-sm text-indigo-700 dark:text-indigo-300">{status}</p>}
        <div className={'grid gap-4 ' + (view === 'split' ? 'lg:grid-cols-2' : 'grid-cols-1')}>
          {view !== 'preview' && (
            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 p-4 text-sm font-bold dark:border-slate-800">
                index.html <span className="ml-2 font-normal text-slate-500">Editable source</span>
              </div>
              <label className="sr-only" htmlFor="studio-html">HTML source code</label>
              <textarea
                id="studio-html"
                spellCheck={false}
                value={project.html}
                maxLength={MAX_HTML_LENGTH}
                onChange={(event) => setProject((current) => ({ ...current, html: event.target.value }))}
                className="min-h-[560px] w-full resize-y bg-white p-4 font-mono text-xs leading-5 text-slate-800 outline-offset-[-4px] focus:outline-indigo-600 dark:bg-slate-950 dark:text-slate-200"
                aria-label="HTML source code"
              />
            </section>
          )}
          {view !== 'code' && (
            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800">
              <div className="border-b border-slate-200 p-4 text-sm font-bold dark:border-slate-800">
                Sandboxed live preview <span className="ml-2 font-normal text-slate-500">Scripts and network blocked</span>
              </div>
              <iframe
                title="Studio sandboxed preview"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview}
                className="min-h-[560px] w-full bg-white"
              />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
